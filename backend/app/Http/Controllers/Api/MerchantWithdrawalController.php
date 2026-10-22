<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\Withdrawal;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class MerchantWithdrawalController extends Controller
{
    /**
     * Strict bank & e-wallet provider formatting rules (Module 5 Option C — Payout Validator).
     *
     * @var array<string, array{method: string, digits: int, prefix_regex: string, hint: string}>
     */
    private const PAYOUT_RULES = [
        'BDO' => [
            'method' => 'bank_transfer',
            'digits' => 12,
            'prefix_regex' => '/^\d{12}$/',
            'hint' => 'BDO Unibank account numbers must be exactly 12 digits (e.g., 001234567890).',
        ],
        'BPI' => [
            'method' => 'bank_transfer',
            'digits' => 10,
            'prefix_regex' => '/^\d{10}$/',
            'hint' => 'BPI account numbers must be exactly 10 digits (e.g., 1234567890).',
        ],
        'LANDBANK' => [
            'method' => 'bank_transfer',
            'digits' => 10,
            'prefix_regex' => '/^\d{10}$/',
            'hint' => 'LandBank of the Philippines account numbers must be exactly 10 digits (e.g., 3456789012).',
        ],
        'METROBANK' => [
            'method' => 'bank_transfer',
            'digits' => 13,
            'prefix_regex' => '/^\d{13}$/',
            'hint' => 'Metrobank account numbers must be exactly 13 digits (e.g., 1234567890123).',
        ],
        'GCASH' => [
            'method' => 'gcash',
            'digits' => 11,
            'prefix_regex' => '/^09\d{9}$/',
            'hint' => 'GCash mobile numbers must be 11 digits starting with 09 (or +639XXXXXXXXX normalized to 09XXXXXXXXX).',
        ],
        'MAYA' => [
            'method' => 'maya',
            'digits' => 11,
            'prefix_regex' => '/^09\d{9}$/',
            'hint' => 'Maya e-wallet mobile numbers must be 11 digits starting with 09 (or +639XXXXXXXXX normalized to 09XXXXXXXXX).',
        ],
    ];

    public function index(Request $request): JsonResponse
    {
        /** @var User $merchant */
        $merchant = $request->user();

        $withdrawals = Withdrawal::where('merchant_id', $merchant->id)
            ->orderByDesc('id')
            ->limit(25)
            ->get();

        return response()->json([
            'status' => 'success',
            'wallet_balance' => number_format((float) $merchant->wallet_balance, 2, '.', ''),
            'payout_rules' => self::PAYOUT_RULES,
            'withdrawals' => $withdrawals,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:500', 'max:500000'],
            'payout_method' => ['required', 'string', 'in:bank_transfer,gcash,maya'],
            'provider_name' => ['required', 'string', 'in:BDO,BPI,LANDBANK,METROBANK,GCASH,MAYA'],
            'account_name' => [
                'required',
                'string',
                'min:5',
                'max:100',
                'regex:/^[A-Za-z][A-Za-z\s\.\-\']+[A-Za-z\.]$/',
            ],
            'account_number' => ['required', 'string', 'max:32'],
        ], [
            'amount.min' => 'Minimum merchant payout withdrawal is PHP 500.00.',
            'account_name.regex' => 'Account holder name must contain only letters, spaces, periods, or hyphens (no digits or special symbols).',
        ]);

        $providerKey = strtoupper($validated['provider_name']);
        $rule = self::PAYOUT_RULES[$providerKey] ?? null;

        if (!$rule || $rule['method'] !== $validated['payout_method']) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'MISMATCHED_PAYOUT_PROVIDER',
                'message' => "Selected provider [{$providerKey}] does not match payout method [{$validated['payout_method']}].",
            ], 422);
        }

        // Normalize account number: strip spaces and dashes; for PH mobile e-wallets convert +639... to 09...
        $rawAccount = preg_replace('/[\s\-]/', '', trim($validated['account_number'])) ?? '';
        if (in_array($providerKey, ['GCASH', 'MAYA'], true) && str_starts_with($rawAccount, '+639')) {
            $rawAccount = '09' . substr($rawAccount, 4);
        }

        if (!preg_match($rule['prefix_regex'], $rawAccount)) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'MALFORMED_PAYOUT_ACCOUNT',
                'message' => "Invalid {$providerKey} account format: {$rule['hint']}",
                'errors' => [
                    'account_number' => [$rule['hint']],
                ],
            ], 422);
        }

        // Reject trivial/all-identical repeating digits (e.g., 0000000000 or 09999999999)
        if (preg_match('/^(\d)\1+$/', $rawAccount) || (in_array($providerKey, ['GCASH', 'MAYA'], true) && preg_match('/^09(\d)\1{8}$/', $rawAccount))) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'INVALID_REPEATING_ACCOUNT_DIGITS',
                'message' => 'Account/mobile number fails checksum sanity check (repeating placeholder digits are not allowed).',
                'errors' => [
                    'account_number' => ['Account/mobile number cannot consist of repeating placeholder digits.'],
                ],
            ], 422);
        }

        /** @var User $authMerchant */
        $authMerchant = $request->user();
        $amount = round((float) $validated['amount'], 2);

        return DB::transaction(function () use ($authMerchant, $amount, $validated, $providerKey, $rawAccount) {
            /** @var User $merchant */
            $merchant = User::where('id', $authMerchant->id)->lockForUpdate()->firstOrFail();

            if ((float) $merchant->wallet_balance < $amount) {
                throw ValidationException::withMessages([
                    'amount' => [
                        sprintf(
                            'Requested withdrawal (PHP %s) exceeds available Merchant Wallet balance (PHP %s).',
                            number_format($amount, 2),
                            number_format((float) $merchant->wallet_balance, 2)
                        ),
                    ],
                ]);
            }

            $merchant->wallet_balance = round((float) $merchant->wallet_balance - $amount, 2);
            $merchant->save();

            $withdrawal = Withdrawal::create([
                'uuid' => (string) Str::uuid(),
                'merchant_id' => $merchant->id,
                'amount' => $amount,
                'payout_method' => $validated['payout_method'],
                'provider_name' => $providerKey,
                'account_name' => trim($validated['account_name']),
                'account_number' => $rawAccount,
                'status' => 'completed',
                'reference_number' => 'WD-' . strtoupper(Str::random(10)),
            ]);

            return response()->json([
                'status' => 'success',
                'message' => "Payout withdrawal of PHP " . number_format($amount, 2) . " to {$providerKey} ({$rawAccount}) processed.",
                'wallet_balance' => number_format((float) $merchant->wallet_balance, 2, '.', ''),
                'withdrawal' => $withdrawal,
            ], 201);
        });
    }
}
