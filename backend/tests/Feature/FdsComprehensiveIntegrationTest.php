<?php

namespace Tests\Feature;

use App\Models\PaymentLog;
use App\Models\Product;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class FdsComprehensiveIntegrationTest extends TestCase
{
    use RefreshDatabase;

    protected User $merchant;
    protected User $farmer1;
    protected User $farmer2;
    protected Product $ureaProduct;
    protected Product $npkProduct;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);

        $this->merchant = User::where('email', 'merchant@fds.gov.ph')->firstOrFail();
        $this->farmer1 = User::where('email', 'farmer@fds.gov.ph')->firstOrFail();
        $this->farmer2 = User::where('email', 'farmer2@fds.gov.ph')->firstOrFail();

        $this->ureaProduct = Product::where('sku', 'FERT-UREA-4600')->firstOrFail();
        $this->npkProduct = Product::where('sku', 'FERT-COMPLETE-141414')->firstOrFail();
    }

    /**
     * Module 5 Option B (Part 1): Successful Merchant POS creation & signed QR payload generation.
     */
    public function test_merchant_can_create_pos_transaction_with_signed_qr_payload(): void
    {
        Sanctum::actingAs($this->merchant, ['merchant']);

        // 1. Verify exact-match Beneficiary ID
        $verifyRes = $this->getJson('/api/merchant/beneficiaries/verify?beneficiary_id=' . $this->farmer1->beneficiary_id);
        $verifyRes->assertStatus(200)
            ->assertJsonPath('valid', true)
            ->assertJsonPath('beneficiary.beneficiary_id', 'RSBSA-03-2026-00142');

        // 2. Partial Beneficiary ID must NOT match (Privacy Protection)
        $partialRes = $this->getJson('/api/merchant/beneficiaries/verify?beneficiary_id=RSBSA-03-2026');
        $partialRes->assertStatus(404)
            ->assertJsonPath('valid', false);

        // 3. Create POS Transaction (2 bags of Urea @ 1650 + 1 bag of Complete NPK @ 1480 = 4780.00)
        $posRes = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer1->beneficiary_id,
            'items' => [
                ['product_id' => $this->ureaProduct->id, 'quantity' => 2],
                ['product_id' => $this->npkProduct->id, 'quantity' => 1],
            ],
        ]);

        $posRes->assertStatus(201)
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('qr_payload.beneficiary_id', $this->farmer1->beneficiary_id)
            ->assertJsonPath('qr_payload.total_amount', '4780.00');

        $qrPayload = $posRes->json('qr_payload');
        $this->assertNotEmpty($qrPayload['signature']);
        $this->assertStringContainsString($this->farmer1->beneficiary_id . '|' . $qrPayload['transaction_uuid'] . '|', $qrPayload['reference_string']);
    }

    /**
     * Module 5 Option B (Part 2): Rejection of unauthorized scanning by the wrong farmer.
     */
    public function test_rejects_unauthorized_qr_scan_by_wrong_farmer(): void
    {
        Sanctum::actingAs($this->merchant, ['merchant']);

        $posRes = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer1->beneficiary_id,
            'items' => [
                ['product_id' => $this->npkProduct->id, 'quantity' => 1],
            ],
        ]);
        $posRes->assertStatus(201);
        $qrPayload = $posRes->json('qr_payload');

        // Now authenticate as Farmer 2 (Pedro Penduko, RSBSA-03-2026-00889) and attempt to scan Farmer 1's QR code
        Sanctum::actingAs($this->farmer2, ['farmer']);

        $scanRes = $this->postJson('/api/farmer/qr/scan', [
            'qr_payload' => $qrPayload,
        ]);

        $scanRes->assertStatus(403)
            ->assertJsonPath('error_code', 'UNAUTHORIZED_FARMER_SCAN');
    }

    /**
     * Module 5 Option B (Part 3): Single-decrement stock verification & idempotent dual-path settlement.
     */
    public function test_single_decrement_stock_verification_and_idempotent_settlement(): void
    {
        $initialUreaStock = $this->ureaProduct->stock_quantity; // 45
        $initialFarmerBalance = (float) $this->farmer1->subsidy_balance; // 15000.00
        $initialMerchantWallet = (float) $this->merchant->wallet_balance; // 25000.00

        // 1. Merchant creates POS transaction for 3 bags of Urea (3 * 1650 = 4950.00)
        Sanctum::actingAs($this->merchant, ['merchant']);
        $posRes = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer1->beneficiary_id,
            'items' => [
                ['product_id' => $this->ureaProduct->id, 'quantity' => 3],
            ],
        ]);
        $posRes->assertStatus(201);
        $qrPayload = $posRes->json('qr_payload');
        $txUuid = $qrPayload['transaction_uuid'];

        // 2. Farmer 1 scans the QR code and initiates checkout session
        Sanctum::actingAs($this->farmer1, ['farmer']);
        $scanRes = $this->postJson('/api/farmer/qr/scan', ['qr_payload' => $qrPayload]);
        $scanRes->assertStatus(200)
            ->assertJsonPath('security_verification.hmac_signature_valid', true);

        $checkoutRes = $this->postJson("/api/farmer/transactions/{$txUuid}/checkout");
        $checkoutRes->assertStatus(200);

        // 3. Path A: Asynchronous Webhook settles the transaction
        $webhookEventId = 'evt_webhook_live_' . $txUuid;
        $webhookRes1 = $this->postJson('/api/webhooks/payment', [
            'event_id' => $webhookEventId,
            'event_type' => 'payment.settlement.succeeded',
            'transaction_uuid' => $txUuid,
            'status' => 'succeeded',
        ]);

        $webhookRes1->assertStatus(200)
            ->assertJsonPath('idempotent_replay', false)
            ->assertJsonPath('transaction.status', 'paid');

        // 4. Retry the exact same Webhook Event ID (simulating webhook retry) -> Must be idempotent no-op
        $webhookRes2 = $this->postJson('/api/webhooks/payment', [
            'event_id' => $webhookEventId,
            'event_type' => 'payment.settlement.succeeded',
            'transaction_uuid' => $txUuid,
            'status' => 'succeeded',
        ]);

        $webhookRes2->assertStatus(200)
            ->assertJsonPath('idempotent_replay', true);

        // 5. Path B: Client-Side Polling Sync arrives after webhook -> Must ALSO be idempotent no-op
        $pollRes = $this->getJson("/api/farmer/transactions/{$txUuid}/poll?reconcile_gateway=true&event_id=evt_poll_{$txUuid}");
        $pollRes->assertStatus(200)
            ->assertJsonPath('idempotent_replay', true)
            ->assertJsonPath('transaction.status', 'paid');

        // 6. Verify Single-Decrement Stock & Financial Integrity
        $this->ureaProduct->refresh();
        $this->farmer1->refresh();
        $this->merchant->refresh();

        $this->assertSame($initialUreaStock - 3, $this->ureaProduct->stock_quantity, 'Stock must be decremented exactly once by 3 bags.');
        $this->assertEqualsWithDelta($initialFarmerBalance - 4950.00, (float) $this->farmer1->subsidy_balance, 0.01);
        $this->assertEqualsWithDelta($initialMerchantWallet + 4950.00, (float) $this->merchant->wallet_balance, 0.01);
        $this->assertSame(1, PaymentLog::where('transaction_id', $posRes->json('transaction.id'))->where('status', 'settled')->count());
    }

    /**
     * Module 4: Cryptographic Tamper-Proofing (rejects manually altered total_amount or beneficiary_id).
     */
    public function test_rejects_tampered_qr_payload_when_amount_or_beneficiary_is_altered(): void
    {
        Sanctum::actingAs($this->merchant, ['merchant']);
        $posRes = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer1->beneficiary_id,
            'items' => [
                ['product_id' => $this->npkProduct->id, 'quantity' => 2],
            ],
        ]);
        $qrPayload = $posRes->json('qr_payload');

        Sanctum::actingAs($this->farmer1, ['farmer']);

        // Tamper 1: Alter total_amount from 2960.00 to 100.00
        $tamperedAmountPayload = $qrPayload;
        $tamperedAmountPayload['total_amount'] = '100.00';

        $res1 = $this->postJson('/api/farmer/qr/scan', ['qr_payload' => $tamperedAmountPayload]);
        $res1->assertStatus(422)
            ->assertJsonPath('error_code', 'SIGNATURE_MISMATCH_TAMPERED_PAYLOAD');

        // Tamper 2: Alter beneficiary_id in payload
        $tamperedBeneficiaryPayload = $qrPayload;
        $tamperedBeneficiaryPayload['beneficiary_id'] = 'RSBSA-03-2026-99999';

        $res2 = $this->postJson('/api/farmer/qr/scan', ['qr_payload' => $tamperedBeneficiaryPayload]);
        $res2->assertStatus(422)
            ->assertJsonPath('error_code', 'TAMPERED_COMPOSITE_REFERENCE');
    }

    /**
     * Module 5 Option A: Subsidy Quota (Restrict each farmer to max 5 bags of high-nitrogen fertilizer per cropping season).
     */
    public function test_enforces_maximum_5_bags_high_nitrogen_fertilizer_subsidy_quota(): void
    {
        Sanctum::actingAs($this->merchant, ['merchant']);

        // Attempt to order 6 bags of Granular Urea (High-Nitrogen) in a single transaction -> Must fail with SUBSIDY_QUOTA_EXCEEDED
        $exceedRes = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer1->beneficiary_id,
            'items' => [
                ['product_id' => $this->ureaProduct->id, 'quantity' => 6],
            ],
        ]);

        $exceedRes->assertStatus(422)
            ->assertJsonPath('error_code', 'SUBSIDY_QUOTA_EXCEEDED');
    }

    /**
     * Module 5 Option C: Payout Validator (Strict bank account and mobile e-wallet formatting & validation rules).
     */
    public function test_enforces_strict_merchant_withdrawal_payout_validation_rules(): void
    {
        Sanctum::actingAs($this->merchant, ['merchant']);

        // 1. Reject malformed GCash number (wrong prefix / length)
        $badGcash = $this->postJson('/api/merchant/withdrawals', [
            'amount' => 1500,
            'payout_method' => 'gcash',
            'provider_name' => 'GCASH',
            'account_name' => 'Maria Clara',
            'account_number' => '0812345',
        ]);
        $badGcash->assertStatus(422)
            ->assertJsonPath('error_code', 'MALFORMED_PAYOUT_ACCOUNT');

        // 2. Reject malformed BDO bank account (must be 12 digits, given 10)
        $badBdo = $this->postJson('/api/merchant/withdrawals', [
            'amount' => 2000,
            'payout_method' => 'bank_transfer',
            'provider_name' => 'BDO',
            'account_name' => 'Maria Clara Agro Supply',
            'account_number' => '1234567890',
        ]);
        $badBdo->assertStatus(422)
            ->assertJsonPath('error_code', 'MALFORMED_PAYOUT_ACCOUNT');

        // 3. Accept valid 12-digit BDO account and deduct from Merchant Wallet
        $validBdo = $this->postJson('/api/merchant/withdrawals', [
            'amount' => 5000,
            'payout_method' => 'bank_transfer',
            'provider_name' => 'BDO',
            'account_name' => 'Maria Clara Agro Supply',
            'account_number' => '004589123045',
        ]);
        $validBdo->assertStatus(201)
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('wallet_balance', '20000.00');
    }

    /**
     * Module 4: 15-Minute Time-To-Live (TTL) expiration enforcement & Pessimistic Inventory Oversell Protection.
     */
    public function test_enforces_15_minute_qr_ttl_and_prevents_inventory_overselling_race_condition(): void
    {
        $vermiProduct = Product::where('sku', 'FERT-VERMI-ORG')->firstOrFail(); // Stock = 3

        Sanctum::actingAs($this->merchant, ['merchant']);

        // Create two simultaneous pending POS orders each requesting 2 bags of Vermicompost (Total 4 > Stock 3)
        $orderA = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer1->beneficiary_id,
            'items' => [['product_id' => $vermiProduct->id, 'quantity' => 2]],
        ])->assertStatus(201);

        $orderB = $this->postJson('/api/merchant/transactions', [
            'beneficiary_id' => $this->farmer2->beneficiary_id,
            'items' => [['product_id' => $vermiProduct->id, 'quantity' => 2]],
        ])->assertStatus(201);

        // Settle Order A first -> Succeeds, stock drops from 3 to 1
        $this->postJson('/api/webhooks/payment', [
            'event_id' => 'evt_race_order_a',
            'event_type' => 'payment.settlement.succeeded',
            'transaction_uuid' => $orderA->json('qr_payload.transaction_uuid'),
            'status' => 'succeeded',
        ])->assertStatus(200);

        // Settle Order B second -> Must be rejected by pessimistic row lock check because only 1 bag remains!
        $this->postJson('/api/webhooks/payment', [
            'event_id' => 'evt_race_order_b',
            'event_type' => 'payment.settlement.succeeded',
            'transaction_uuid' => $orderB->json('qr_payload.transaction_uuid'),
            'status' => 'succeeded',
        ])->assertStatus(422)
            ->assertJsonPath('error_code', 'SETTLEMENT_REJECTED');

        $vermiProduct->refresh();
        $this->assertSame(1, $vermiProduct->stock_quantity, 'Pessimistic row lock prevented overselling.');

        // Verify 15-minute TTL expiration rejection when scanning an expired QR payload
        $expiredPayload = $orderB->json('qr_payload');
        $this->travel(16)->minutes();

        Sanctum::actingAs($this->farmer2, ['farmer']);
        $this->postJson('/api/farmer/qr/scan', [
            'qr_payload' => $expiredPayload,
        ])->assertStatus(422)
            ->assertJsonPath('error_code', 'QR_TOKEN_EXPIRED');
    }
}
