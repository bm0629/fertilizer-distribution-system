<?php

namespace App\Contracts;

use App\Models\Transaction;

interface PaymentGatewayInterface
{
    /**
     * Create a hosted checkout session for a validated transaction.
     *
     * @return array{checkout_session_id: string, checkout_url: string, expires_at: string, provider: string}
     */
    public function createCheckoutSession(Transaction $transaction): array;

    /**
     * Verify webhook signature authenticity from the payment gateway.
     */
    public function verifyWebhookSignature(string $rawPayload, string $signatureHeader): bool;

    /**
     * Generate a signed webhook payload for simulation/testing or internal gateway dispatch.
     */
    public function signWebhookPayload(array $payload): string;

    /**
     * Query the gateway for the real-time status of a checkout session (used for client-side polling fallback).
     *
     * @return array{session_id: string, status: string, event_id: string, amount: string}
     */
    public function fetchSessionStatus(Transaction $transaction): array;
}
