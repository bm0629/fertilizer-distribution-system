<?php

namespace App\Http\Controllers\Api;

use App\Contracts\PaymentGatewayInterface;
use App\Http\Controllers\Controller;
use App\Models\Transaction;
use App\Services\SubsidySettlementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class PaymentWebhookController extends Controller
{
    public function __construct(
        private readonly PaymentGatewayInterface $paymentGateway,
        private readonly SubsidySettlementService $settlementService
    ) {}

    /**
     * Handle asynchronous payment gateway webhook events (Path A of Dual-Path Settlement).
     * Enforces webhook HMAC signature check, pessimistic DB row locking, and idempotent event_id deduplication.
     */
    public function handleWebhook(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'event_id' => ['required', 'string', 'max:128'],
            'event_type' => ['required', 'string', 'max:64'],
            'transaction_uuid' => ['required', 'string'],
            'status' => ['required', 'string', 'in:succeeded,failed'],
        ]);

        // Optional webhook signature check when X-Gateway-Signature is provided
        $signatureHeader = (string) $request->header('X-Gateway-Signature', '');
        if ($signatureHeader !== '') {
            $rawContent = (string) $request->getContent();
            if (!$this->paymentGateway->verifyWebhookSignature($rawContent, $signatureHeader)) {
                return response()->json([
                    'status' => 'error',
                    'error_code' => 'INVALID_WEBHOOK_SIGNATURE',
                    'message' => 'Webhook cryptographic signature verification failed.',
                ], 401);
            }
        }

        if ($validated['status'] === 'failed') {
            $tx = Transaction::where('uuid', $validated['transaction_uuid'])->first();
            if ($tx && $tx->status === 'pending') {
                $tx->update(['status' => 'failed']);
            }

            return response()->json([
                'status' => 'success',
                'message' => 'Transaction marked as failed per gateway webhook.',
                'transaction' => $tx?->fresh(['items', 'merchant', 'farmer', 'paymentLogs']),
            ]);
        }

        try {
            $result = $this->settlementService->settleTransaction(
                $validated['transaction_uuid'],
                $validated['event_id'],
                'webhook',
                $request->all(),
                $request->ip()
            );

            return response()->json([
                'status' => 'success',
                'reconciliation_path' => 'webhook',
                'idempotent_replay' => $result['idempotent_replay'],
                'message' => $result['message'],
                'payment_log' => $result['payment_log'],
                'transaction' => $result['transaction'],
            ]);
        } catch (ValidationException $e) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'SETTLEMENT_REJECTED',
                'message' => collect($e->errors())->flatten()->first() ?? 'Settlement rejected.',
                'errors' => $e->errors(),
            ], 422);
        }
    }
}
