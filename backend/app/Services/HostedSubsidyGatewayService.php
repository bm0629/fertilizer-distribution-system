<?php

namespace App\Services;

use App\Contracts\PaymentGatewayInterface;
use App\Models\Transaction;
use Illuminate\Support\Str;

class HostedSubsidyGatewayService implements PaymentGatewayInterface
{
    private string $webhookSecret;
    private string $frontendUrl;

    public function __construct()
    {
        $this->webhookSecret = (string) config('services.fds.payment_gateway_secret', env('PAYMENT_GATEWAY_SECRET', 'whsec_paygateway_live_secret_2026'));
        $this->frontendUrl = rtrim((string) config('services.fds.frontend_url', env('FRONTEND_URL', 'http://localhost:5173')), '/');
    }

    public function createCheckoutSession(Transaction $transaction): array
    {
        $sessionId = $transaction->checkout_session_id ?: ('cs_fds_' . Str::lower(Str::random(24)));

        if (!$transaction->checkout_session_id) {
            $transaction->update(['checkout_session_id' => $sessionId]);
        }

        $checkoutUrl = sprintf(
            '%s/gateway/checkout/%s?tx=%s',
            $this->frontendUrl,
            $sessionId,
            $transaction->uuid
        );

        return [
            'checkout_session_id' => $sessionId,
            'checkout_url' => $checkoutUrl,
            'expires_at' => $transaction->expires_at->toIso8601String(),
            'provider' => 'AgriPay National Subsidy Gateway v2',
        ];
    }

    public function verifyWebhookSignature(string $rawPayload, string $signatureHeader): bool
    {
        if (empty($signatureHeader)) {
            return false;
        }

        $expected = hash_hmac('sha256', $rawPayload, $this->webhookSecret);
        return hash_equals($expected, $signatureHeader);
    }

    public function signWebhookPayload(array $payload): string
    {
        $json = json_encode($payload, JSON_UNESCAPED_SLASHES);
        return hash_hmac('sha256', (string) $json, $this->webhookSecret);
    }

    public function fetchSessionStatus(Transaction $transaction): array
    {
        $sessionId = $transaction->checkout_session_id ?? ('cs_fds_' . $transaction->uuid);

        return [
            'session_id' => $sessionId,
            'status' => $transaction->status,
            'event_id' => 'evt_sync_' . $transaction->uuid,
            'amount' => number_format((float) $transaction->total_amount, 2, '.', ''),
        ];
    }
}
