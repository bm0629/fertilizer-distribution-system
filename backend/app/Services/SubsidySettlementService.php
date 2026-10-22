<?php

namespace App\Services;

use App\Models\PaymentLog;
use App\Models\Product;
use App\Models\Transaction;
use App\Models\TransactionItem;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SubsidySettlementService
{
    private int $maxHighNitrogenBags;

    public function __construct()
    {
        $this->maxHighNitrogenBags = (int) config('services.fds.high_nitrogen_max_bags', env('SUBSIDY_HIGH_NITROGEN_MAX_BAGS', 5));
    }

    /**
     * Calculate how many bags of high-nitrogen fertilizer a farmer has already purchased
     * (in paid transactions) during the specified cropping season.
     */
    public function getFarmerSeasonHighNitrogenUsed(int $farmerId, string $croppingSeason = '2026-WET'): int
    {
        return (int) TransactionItem::query()
            ->where('is_high_nitrogen', true)
            ->whereHas('transaction', function ($query) use ($farmerId, $croppingSeason) {
                $query->where('farmer_id', $farmerId)
                    ->where('cropping_season', $croppingSeason)
                    ->where('status', 'paid');
            })
            ->sum('quantity');
    }

    public function getMaxHighNitrogenQuota(): int
    {
        return $this->maxHighNitrogenBags;
    }

    /**
     * Execute atomic settlement with pessimistic row-level locking (`SELECT ... FOR UPDATE`)
     * and idempotent event audit logging.
     *
     * @param array<string, mixed> $rawPayload
     * @return array{settled: bool, idempotent_replay: bool, transaction: Transaction, payment_log: PaymentLog, message: string}
     */
    public function settleTransaction(
        string $transactionUuid,
        string $eventId,
        string $settlementChannel = 'webhook',
        array $rawPayload = [],
        ?string $ipAddress = null
    ): array {
        return DB::transaction(function () use ($transactionUuid, $eventId, $settlementChannel, $rawPayload, $ipAddress) {
            // 1. Idempotency Guard: Check if this exact event_id was already processed
            $existingLog = PaymentLog::where('event_id', $eventId)->lockForUpdate()->first();
            if ($existingLog) {
                $tx = Transaction::with(['items', 'merchant', 'farmer', 'paymentLogs'])->findOrFail($existingLog->transaction_id);
                return [
                    'settled' => true,
                    'idempotent_replay' => true,
                    'transaction' => $tx,
                    'payment_log' => $existingLog,
                    'message' => "Idempotent replay detected: Event [{$eventId}] was already settled at {$existingLog->processed_at->toIso8601String()}. Duplicate settlement prevented.",
                ];
            }

            // 2. Lock the Transaction row first (`SELECT ... FOR UPDATE`)
            $transaction = Transaction::where('uuid', $transactionUuid)
                ->lockForUpdate()
                ->first();

            if (!$transaction) {
                throw ValidationException::withMessages([
                    'transaction_uuid' => ['Transaction record not found for settlement.'],
                ]);
            }

            // 3. If Transaction is already paid (e.g., settled via webhook first, then polling sync arrived with a different event_id)
            if ($transaction->status === 'paid') {
                $firstPaidLog = PaymentLog::where('transaction_id', $transaction->id)
                    ->where('status', 'settled')
                    ->first();

                // Record an idempotent audit log or return existing log without re-decrementing stock or balance
                $replayLog = PaymentLog::firstOrCreate(
                    ['event_id' => $eventId],
                    [
                        'transaction_id' => $transaction->id,
                        'event_type' => 'payment.already_settled.noop',
                        'settlement_channel' => $settlementChannel,
                        'amount' => $transaction->total_amount,
                        'status' => 'idempotent_noop',
                        'payload_snapshot' => array_merge($rawPayload, [
                            'note' => 'Transaction already in paid state; balances and inventory untouched.',
                        ]),
                        'ip_address' => $ipAddress,
                        'processed_at' => Carbon::now(),
                    ]
                );

                $transaction->load(['items', 'merchant', 'farmer', 'paymentLogs']);

                return [
                    'settled' => true,
                    'idempotent_replay' => true,
                    'transaction' => $transaction,
                    'payment_log' => $firstPaidLog ?? $replayLog,
                    'message' => 'Transaction was already settled via primary channel. Dual-reconciliation verified state without duplicate deduction.',
                ];
            }

            if ($transaction->status !== 'pending') {
                throw ValidationException::withMessages([
                    'status' => ["Transaction cannot be settled because its status is [{$transaction->status}]."],
                ]);
            }

            // Check TTL expiration before settlement
            if (Carbon::now()->greaterThan($transaction->expires_at)) {
                $transaction->update(['status' => 'failed']);
                throw ValidationException::withMessages([
                    'expires_at' => ['Transaction QR session has expired (15-minute TTL exceeded) and cannot be settled.'],
                ]);
            }

            // 4. Pessimistic Row Locking on Users in deterministic ascending ID order to prevent deadlocks
            $userIds = [$transaction->farmer_id, $transaction->merchant_id];
            sort($userIds);

            $lockedUsers = User::whereIn('id', $userIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            /** @var User $farmer */
            $farmer = $lockedUsers->get($transaction->farmer_id);
            /** @var User $merchant */
            $merchant = $lockedUsers->get($transaction->merchant_id);

            // 5. Pessimistic Row Locking on Products in deterministic ascending ID order
            $items = TransactionItem::where('transaction_id', $transaction->id)
                ->orderBy('product_id')
                ->get();

            $productIds = $items->pluck('product_id')->unique()->sort()->values()->all();
            $lockedProducts = Product::whereIn('id', $productIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            // 6. Verify Module 5 Option A: High-Nitrogen Subsidy Quota under lock
            $requestedHighNitrogenBags = (int) $items->where('is_high_nitrogen', true)->sum('quantity');
            if ($requestedHighNitrogenBags > 0) {
                $usedHighNitrogenBags = $this->getFarmerSeasonHighNitrogenUsed($farmer->id, $transaction->cropping_season);
                if (($usedHighNitrogenBags + $requestedHighNitrogenBags) > $this->maxHighNitrogenBags) {
                    $remaining = max(0, $this->maxHighNitrogenBags - $usedHighNitrogenBags);
                    throw ValidationException::withMessages([
                        'subsidy_quota' => [
                            "Subsidy Quota Exceeded: Each farmer is restricted to a maximum quota of {$this->maxHighNitrogenBags} bags of high-nitrogen fertilizer per cropping season ({$transaction->cropping_season}). Used: {$usedHighNitrogenBags} bag(s), Requested: {$requestedHighNitrogenBags} bag(s), Remaining Quota: {$remaining} bag(s).",
                        ],
                    ]);
                }
            }

            // 7. Verify Farmer Subsidy Balance under pessimistic lock
            $totalAmount = (float) $transaction->total_amount;
            if ((float) $farmer->subsidy_balance < $totalAmount) {
                $transaction->update(['status' => 'failed']);
                throw ValidationException::withMessages([
                    'subsidy_balance' => [
                        sprintf(
                            'Insufficient farmer subsidy balance. Available: PHP %s, Required: PHP %s.',
                            number_format((float) $farmer->subsidy_balance, 2),
                            number_format($totalAmount, 2)
                        ),
                    ],
                ]);
            }

            // 8. Verify and Decrement Exact Line-Item Quantities from Merchant Inventory
            foreach ($items as $item) {
                /** @var Product|null $product */
                $product = $lockedProducts->get($item->product_id);
                if (!$product || $product->stock_quantity < $item->quantity) {
                    $available = $product ? $product->stock_quantity : 0;
                    throw ValidationException::withMessages([
                        'stock_quantity' => [
                            "Insufficient stock for [{$item->product_name}]. Available: {$available}, Requested: {$item->quantity}.",
                        ],
                    ]);
                }

                $product->stock_quantity -= $item->quantity;
                $product->save();
            }

            // 9. Deduct Purchase Amount from Farmer's Subsidy Balance & Credit Merchant's Wallet
            $farmer->subsidy_balance = round((float) $farmer->subsidy_balance - $totalAmount, 2);
            $farmer->save();

            $merchant->wallet_balance = round((float) $merchant->wallet_balance + $totalAmount, 2);
            $merchant->save();

            // 10. Update Transaction Status to `paid`
            $now = Carbon::now();
            $transaction->update([
                'status' => 'paid',
                'paid_at' => $now,
            ]);

            // 11. Write Immutable Entry into Payment Audit Trail
            $paymentLog = PaymentLog::create([
                'event_id' => $eventId,
                'transaction_id' => $transaction->id,
                'event_type' => 'payment.settlement.succeeded',
                'settlement_channel' => $settlementChannel,
                'amount' => $transaction->total_amount,
                'status' => 'settled',
                'payload_snapshot' => array_merge($rawPayload, [
                    'reference_string' => $transaction->reference_string,
                    'beneficiary_id' => $transaction->beneficiary_id,
                    'farmer_new_balance' => number_format((float) $farmer->subsidy_balance, 2, '.', ''),
                    'merchant_new_wallet' => number_format((float) $merchant->wallet_balance, 2, '.', ''),
                ]),
                'ip_address' => $ipAddress,
                'processed_at' => $now,
            ]);

            $transaction->load(['items', 'merchant', 'farmer', 'paymentLogs']);

            return [
                'settled' => true,
                'idempotent_replay' => false,
                'transaction' => $transaction,
                'payment_log' => $paymentLog,
                'message' => 'Payment reconciled and settled atomically.',
            ];
        });
    }
}
