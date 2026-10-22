<?php

namespace App\Services;

use Carbon\Carbon;
use InvalidArgumentException;

class CryptographicQrService
{
    private string $secretKey;
    private int $ttlMinutes;

    public function __construct()
    {
        $this->secretKey = (string) config('services.fds.qr_hmac_secret', env('QR_HMAC_SECRET', 'fds_super_secret_hmac_signing_key_2026_gov_subsidy'));
        $this->ttlMinutes = (int) config('services.fds.qr_ttl_minutes', env('QR_TTL_MINUTES', 15));
    }

    /**
     * Build the composite reference string required by Module 4:
     * Format: BeneficiaryID|UUID|Timestamp
     */
    public function buildCompositeReference(string $beneficiaryId, string $uuid, int $timestamp): string
    {
        return sprintf('%s|%s|%d', trim($beneficiaryId), trim($uuid), $timestamp);
    }

    /**
     * Normalize decimal amount to strict 2-decimal representation for deterministic signing.
     */
    public function normalizeAmount(float|string $amount): string
    {
        return number_format((float) $amount, 2, '.', '');
    }

    /**
     * Generate an HMAC-SHA256 signature binding the composite reference, merchant ID, and total_amount.
     */
    public function generateSignature(
        string $beneficiaryId,
        string $uuid,
        int $timestamp,
        int $merchantId,
        float|string $totalAmount
    ): string {
        $reference = $this->buildCompositeReference($beneficiaryId, $uuid, $timestamp);
        $normalizedAmount = $this->normalizeAmount($totalAmount);

        $canonicalString = implode('|', [
            $reference,
            (string) $merchantId,
            $normalizedAmount,
        ]);

        return hash_hmac('sha256', $canonicalString, $this->secretKey);
    }

    /**
     * Construct the full signed QR payload for the Merchant POS terminal.
     *
     * @return array<string, mixed>
     */
    public function createSignedPayload(
        string $uuid,
        string $beneficiaryId,
        int $merchantId,
        float|string $totalAmount,
        ?int $timestamp = null
    ): array {
        $ts = $timestamp ?? Carbon::now()->timestamp;
        $expiresAt = Carbon::createFromTimestamp($ts)->addMinutes($this->ttlMinutes);
        $reference = $this->buildCompositeReference($beneficiaryId, $uuid, $ts);
        $normalizedAmount = $this->normalizeAmount($totalAmount);
        $signature = $this->generateSignature($beneficiaryId, $uuid, $ts, $merchantId, $normalizedAmount);

        return [
            'protocol' => 'FDS-QR-V1',
            'transaction_uuid' => $uuid,
            'beneficiary_id' => $beneficiaryId,
            'merchant_id' => $merchantId,
            'total_amount' => $normalizedAmount,
            'timestamp' => $ts,
            'expires_at' => $expiresAt->toIso8601String(),
            'reference_string' => $reference,
            'signature' => $signature,
        ];
    }

    /**
     * Validate a scanned QR payload for cryptographic integrity, composite reference consistency, and 15-minute TTL.
     *
     * @param array<string, mixed> $payload
     * @return array{valid: bool, error_code?: string, message?: string}
     */
    public function verifyPayload(array $payload, int $expectedMerchantId, string $dbBeneficiaryId, float|string $dbTotalAmount, string $dbSignature): array
    {
        $requiredFields = ['transaction_uuid', 'beneficiary_id', 'total_amount', 'timestamp', 'reference_string', 'signature'];
        foreach ($requiredFields as $field) {
            if (!isset($payload[$field]) || $payload[$field] === '') {
                return [
                    'valid' => false,
                    'error_code' => 'MALFORMED_QR_PAYLOAD',
                    'message' => "Missing required security field [{$field}] in QR payload.",
                ];
            }
        }

        $uuid = (string) $payload['transaction_uuid'];
        $beneficiaryId = (string) $payload['beneficiary_id'];
        $timestamp = (int) $payload['timestamp'];
        $providedReference = (string) $payload['reference_string'];
        $providedSignature = (string) $payload['signature'];
        $providedAmount = $this->normalizeAmount($payload['total_amount']);

        // 1. Reconstruct composite reference string and verify against provided reference
        $expectedReference = $this->buildCompositeReference($beneficiaryId, $uuid, $timestamp);
        if (!hash_equals($expectedReference, $providedReference)) {
            return [
                'valid' => false,
                'error_code' => 'TAMPERED_COMPOSITE_REFERENCE',
                'message' => 'Cryptographic verification failed: Composite reference string (BeneficiaryID|UUID|Timestamp) does not match payload attributes.',
            ];
        }

        // 2. Recompute HMAC-SHA256 signature from payload fields and compare in constant time
        $recomputedFromPayload = $this->generateSignature(
            $beneficiaryId,
            $uuid,
            $timestamp,
            $expectedMerchantId,
            $providedAmount
        );

        if (!hash_equals($recomputedFromPayload, $providedSignature) || !hash_equals($dbSignature, $providedSignature)) {
            return [
                'valid' => false,
                'error_code' => 'SIGNATURE_MISMATCH_TAMPERED_PAYLOAD',
                'message' => 'Cryptographic signature verification failed: Payload has been tampered with (total_amount, beneficiary_id, or signature altered).',
            ];
        }

        // 3. Verify database canonical fields match payload (defense in depth)
        if ($beneficiaryId !== $dbBeneficiaryId || $providedAmount !== $this->normalizeAmount($dbTotalAmount)) {
            return [
                'valid' => false,
                'error_code' => 'PAYLOAD_STATE_MISMATCH',
                'message' => 'Cryptographic verification failed: Payload values diverge from the immutable transaction record.',
            ];
        }

        // 4. Enforce 15-minute Time-To-Live (TTL) window
        $now = Carbon::now()->timestamp;
        $maxAgeSeconds = $this->ttlMinutes * 60;

        if (($now - $timestamp) > $maxAgeSeconds) {
            return [
                'valid' => false,
                'error_code' => 'QR_TOKEN_EXPIRED',
                'message' => "QR payment token has expired. Tokens have a strict {$this->ttlMinutes}-minute Time-To-Live (TTL).",
            ];
        }

        if (($timestamp - $now) > 60) {
            return [
                'valid' => false,
                'error_code' => 'INVALID_FUTURE_TIMESTAMP',
                'message' => 'QR token timestamp is invalid (clock skew / future timestamp detected).',
            ];
        }

        return ['valid' => true];
    }
}
