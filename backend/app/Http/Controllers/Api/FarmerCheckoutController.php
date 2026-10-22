<?php

namespace App\Http\Controllers\Api;

use App\Contracts\PaymentGatewayInterface;
use App\Http\Controllers\Controller;
use App\Models\Transaction;
use App\Models\User;
use App\Services\CryptographicQrService;
use App\Services\SubsidySettlementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class FarmerCheckoutController extends Controller
{
    public function __construct(
        private readonly CryptographicQrService $qrService,
        private readonly PaymentGatewayInterface $paymentGateway,
        private readonly SubsidySettlementService $settlementService
    ) {}

    /**
     * Step 1: Farmer scans the QR payload.
     * Validates:
     * 1) Transaction existence
     * 2) Cryptographic HMAC-SHA256 signature & composite reference (BeneficiaryID|UUID|Timestamp)
     * 3) 15-minute Time-To-Live (TTL) expiration
     * 4) Strict Farmer Identity Match (rejects unauthorized scanning by wrong farmer)
     */
    public function scanQr(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'qr_payload' => ['required', 'array'],
        ]);

        /** @var User $farmer */
        $farmer = $request->user();
        $payload = $validated['qr_payload'];

        $uuid = (string) ($payload['transaction_uuid'] ?? '');
        if ($uuid === '') {
            return response()->json([
                'status' => 'error',
                'error_code' => 'MISSING_TRANSACTION_UUID',
                'message' => 'QR payload does not contain a valid transaction_uuid.',
            ], 422);
        }

        $transaction = Transaction::with(['items', 'merchant', 'farmer', 'paymentLogs'])
            ->where('uuid', $uuid)
            ->first();

        if (!$transaction) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'TRANSACTION_NOT_FOUND',
                'message' => 'No transaction found matching the scanned QR UUID.',
            ], 404);
        }

        // Step A: Validate cryptographic HMAC signature, composite reference, and 15-minute TTL FIRST
        // so any tampering of beneficiary_id or total_amount is caught as a cryptographic violation.
        $verification = $this->qrService->verifyPayload(
            $payload,
            $transaction->merchant_id,
            $transaction->beneficiary_id,
            $transaction->total_amount,
            $transaction->qr_signature
        );

        if (!$verification['valid']) {
            return response()->json([
                'status' => 'error',
                'error_code' => $verification['error_code'],
                'message' => $verification['message'],
            ], 422);
        }

        // Step B: Enforce Farmer Identity Ownership (Module 5 Option B — Reject unauthorized scanning by wrong farmer)
        if ($transaction->farmer_id !== $farmer->id || $transaction->beneficiary_id !== $farmer->beneficiary_id) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'UNAUTHORIZED_FARMER_SCAN',
                'message' => sprintf(
                    'Unauthorized QR Scan: This subsidy transaction belongs to Beneficiary ID [%s], which does not match your authenticated Beneficiary ID [%s].',
                    $transaction->beneficiary_id,
                    (string) $farmer->beneficiary_id
                ),
            ], 403);
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Cryptographic QR verified. Order summary loaded.',
            'security_verification' => [
                'hmac_signature_valid' => true,
                'composite_reference_valid' => true,
                'ttl_valid' => true,
                'beneficiary_ownership_valid' => true,
                'reference_string' => $transaction->reference_string,
                'expires_at' => $transaction->expires_at->toIso8601String(),
            ],
            'transaction' => $transaction,
        ]);
    }

    /**
     * Step 2: Farmer initiates payment gateway checkout session for a scanned transaction.
     */
    public function createCheckoutSession(Request $request, string $uuid): JsonResponse
    {
        /** @var User $farmer */
        $farmer = $request->user();

        $transaction = Transaction::with(['items', 'merchant'])
            ->where('uuid', $uuid)
            ->first();

        if (!$transaction) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'TRANSACTION_NOT_FOUND',
                'message' => 'Transaction not found.',
            ], 404);
        }

        if ($transaction->farmer_id !== $farmer->id) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'UNAUTHORIZED_FARMER_CHECKOUT',
                'message' => 'You are not authorized to initiate checkout for another farmer\'s transaction.',
            ], 403);
        }

        if ($transaction->status !== 'pending') {
            return response()->json([
                'status' => 'error',
                'error_code' => 'INVALID_TRANSACTION_STATE',
                'message' => "Transaction is already in [{$transaction->status}] status.",
            ], 422);
        }

        if (now()->greaterThan($transaction->expires_at)) {
            $transaction->update(['status' => 'failed']);
            return response()->json([
                'status' => 'error',
                'error_code' => 'QR_TOKEN_EXPIRED',
                'message' => 'This transaction QR has exceeded its 15-minute Time-To-Live (TTL).',
            ], 422);
        }

        $session = $this->paymentGateway->createCheckoutSession($transaction);

        return response()->json([
            'status' => 'success',
            'checkout_session' => $session,
            'transaction' => $transaction->fresh(['items', 'merchant', 'farmer', 'paymentLogs']),
        ]);
    }

    /**
     * Step 3 (Dual-Path Path B — Client-Side Polling / Sync):
     * Poll or synchronize transaction status. If `reconcile_gateway=true` is passed (e.g. when returning
     * from the hosted gateway or recovering after a network drop), it triggers idempotent settlement sync.
     */
    public function pollTransactionStatus(Request $request, string $uuid): JsonResponse
    {
        /** @var User $farmer */
        $farmer = $request->user();

        $transaction = Transaction::with(['items', 'merchant', 'farmer', 'paymentLogs'])
            ->where('uuid', $uuid)
            ->first();

        if (!$transaction) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'TRANSACTION_NOT_FOUND',
                'message' => 'Transaction not found.',
            ], 404);
        }

        if ($transaction->farmer_id !== $farmer->id) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'FORBIDDEN_TRANSACTION_VIEW',
                'message' => 'You are not authorized to view this transaction.',
            ], 403);
        }

        $reconcileGateway = filter_var($request->query('reconcile_gateway', false), FILTER_VALIDATE_BOOLEAN);

        if ($reconcileGateway && in_array($transaction->status, ['pending', 'paid'], true)) {
            $eventId = (string) $request->query('event_id', 'evt_poll_sync_' . $transaction->uuid);

            try {
                $result = $this->settlementService->settleTransaction(
                    $transaction->uuid,
                    $eventId,
                    'polling_sync',
                    [
                        'source' => 'client_polling_reconciliation',
                        'checkout_session_id' => $transaction->checkout_session_id,
                    ],
                    $request->ip()
                );

                return response()->json([
                    'status' => 'success',
                    'reconciliation_path' => 'polling_sync',
                    'idempotent_replay' => $result['idempotent_replay'],
                    'message' => $result['message'],
                    'transaction' => $result['transaction'],
                ]);
            } catch (ValidationException $e) {
                return response()->json([
                    'status' => 'error',
                    'error_code' => 'SETTLEMENT_VALIDATION_FAILED',
                    'message' => collect($e->errors())->flatten()->first() ?? 'Settlement validation failed.',
                    'errors' => $e->errors(),
                ], 422);
            }
        }

        return response()->json([
            'status' => 'success',
            'reconciliation_path' => 'status_poll',
            'transaction' => $transaction,
        ]);
    }

    /**
     * Cancel a pending transaction if the farmer declines on the Order Review screen.
     */
    public function cancelTransaction(Request $request, string $uuid): JsonResponse
    {
        /** @var User $farmer */
        $farmer = $request->user();

        $transaction = Transaction::where('uuid', $uuid)->firstOrFail();

        if ($transaction->farmer_id !== $farmer->id) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'FORBIDDEN',
                'message' => 'You cannot cancel another farmer\'s transaction.',
            ], 403);
        }

        if ($transaction->status !== 'pending') {
            return response()->json([
                'status' => 'error',
                'error_code' => 'INVALID_STATE',
                'message' => "Cannot cancel a transaction in [{$transaction->status}] status.",
            ], 422);
        }

        $transaction->update(['status' => 'cancelled']);

        return response()->json([
            'status' => 'success',
            'message' => 'Transaction cancelled.',
            'transaction' => $transaction->fresh(['items', 'merchant', 'farmer', 'paymentLogs']),
        ]);
    }

    /**
     * List all transactions for the authenticated farmer.
     */
    public function transactions(Request $request): JsonResponse
    {
        /** @var User $farmer */
        $farmer = $request->user();

        $transactions = Transaction::with(['items', 'merchant', 'paymentLogs'])
            ->where('farmer_id', $farmer->id)
            ->orderByDesc('id')
            ->limit(25)
            ->get();

        return response()->json([
            'status' => 'success',
            'transactions' => $transactions,
        ]);
    }
}
