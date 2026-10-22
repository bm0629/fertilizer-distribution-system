<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\Transaction;
use App\Models\TransactionItem;
use App\Models\User;
use App\Services\CryptographicQrService;
use App\Services\SubsidySettlementService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MerchantPosController extends Controller
{
    public function __construct(
        private readonly CryptographicQrService $qrService,
        private readonly SubsidySettlementService $settlementService
    ) {}

    /**
     * List active inventory products for the accredited merchant.
     */
    public function products(Request $request): JsonResponse
    {
        /** @var User $merchant */
        $merchant = $request->user();

        $products = Product::where('merchant_id', $merchant->id)
            ->orderBy('id')
            ->get();

        return response()->json([
            'status' => 'success',
            'merchant' => [
                'id' => $merchant->id,
                'name' => $merchant->name,
                'store_name' => $merchant->store_name,
                'wallet_balance' => number_format((float) $merchant->wallet_balance, 2, '.', ''),
            ],
            'products' => $products,
        ]);
    }

    /**
     * Create a new fertilizer product in merchant inventory.
     */
    public function storeProduct(Request $request): JsonResponse
    {
        /** @var User $merchant */
        $merchant = $request->user();

        $validated = $request->validate([
            'sku' => ['required', 'string', 'max:64', 'unique:products,sku'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:500'],
            'category' => ['required', 'in:high_nitrogen,balanced_npk,organic,potash_phosphate'],
            'npk_ratio' => ['required', 'string', 'max:32'],
            'unit' => ['required', 'string', 'max:64'],
            'unit_price' => ['required', 'numeric', 'min:1'],
            'stock_quantity' => ['required', 'integer', 'min:0'],
        ]);

        $product = Product::create([
            'merchant_id' => $merchant->id,
            'sku' => strtoupper(trim($validated['sku'])),
            'name' => trim($validated['name']),
            'description' => $validated['description'] ?? '',
            'category' => $validated['category'],
            'npk_ratio' => trim($validated['npk_ratio']),
            'is_high_nitrogen' => $validated['category'] === 'high_nitrogen',
            'unit' => trim($validated['unit']),
            'unit_price' => $validated['unit_price'],
            'stock_quantity' => $validated['stock_quantity'],
            'is_active' => true,
        ]);

        return response()->json([
            'status' => 'success',
            'message' => 'Fertilizer product added to inventory.',
            'product' => $product,
        ], 201);
    }

    /**
     * Update an existing fertilizer product's price, stock quantity, or details.
     */
    public function updateProduct(Request $request, int $id): JsonResponse
    {
        /** @var User $merchant */
        $merchant = $request->user();

        $product = Product::where('merchant_id', $merchant->id)->findOrFail($id);

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:500'],
            'category' => ['sometimes', 'in:high_nitrogen,balanced_npk,organic,potash_phosphate'],
            'npk_ratio' => ['sometimes', 'string', 'max:32'],
            'unit_price' => ['sometimes', 'numeric', 'min:1'],
            'stock_quantity' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if (isset($validated['category'])) {
            $validated['is_high_nitrogen'] = $validated['category'] === 'high_nitrogen';
        }

        $product->update($validated);

        return response()->json([
            'status' => 'success',
            'message' => 'Inventory product updated successfully.',
            'product' => $product->fresh(),
        ]);
    }

    /**
     * Exact-match Beneficiary ID verification (Module 2 & Module 6 Privacy Protection).
     * Never exposes partial search or autocomplete to prevent unauthorized enumeration/harvesting.
     */
    public function verifyBeneficiary(Request $request): JsonResponse
    {
        $beneficiaryId = trim((string) $request->query('beneficiary_id', ''));

        if ($beneficiaryId === '') {
            return response()->json([
                'status' => 'invalid',
                'valid' => false,
                'error_code' => 'EMPTY_BENEFICIARY_ID',
                'message' => 'Please enter a complete Beneficiary ID number.',
            ], 422);
        }

        // Strict exact-match query on `beneficiary_id` and `role = farmer`
        $farmer = User::where('role', 'farmer')
            ->where('beneficiary_id', $beneficiaryId)
            ->first();

        if (!$farmer) {
            return response()->json([
                'status' => 'invalid',
                'valid' => false,
                'error_code' => 'BENEFICIARY_NOT_FOUND',
                'message' => 'No registered farmer matched this exact Beneficiary ID in the National Registry.',
            ], 404);
        }

        $usedHighNitrogen = $this->settlementService->getFarmerSeasonHighNitrogenUsed($farmer->id, '2026-WET');
        $maxHighNitrogen = $this->settlementService->getMaxHighNitrogenQuota();

        return response()->json([
            'status' => 'valid',
            'valid' => true,
            'beneficiary' => [
                'id' => $farmer->id,
                'name' => $farmer->name,
                'beneficiary_id' => $farmer->beneficiary_id,
                'region' => $farmer->region,
                'subsidy_balance' => number_format((float) $farmer->subsidy_balance, 2, '.', ''),
                'high_nitrogen_quota' => [
                    'cropping_season' => '2026-WET',
                    'used_bags' => $usedHighNitrogen,
                    'max_bags' => $maxHighNitrogen,
                    'remaining_bags' => max(0, $maxHighNitrogen - $usedHighNitrogen),
                ],
            ],
        ]);
    }

    /**
     * Create a pending POS transaction and generate the signed cryptographic QR payload.
     * Enforces stock boundary checks, farmer balance check, and Module 5 Option A (Max 5 bags High-Nitrogen quota).
     */
    public function createTransaction(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'beneficiary_id' => ['required', 'string', 'max:64'],
            'cropping_season' => ['nullable', 'string', 'max:32'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
        ]);

        /** @var User $merchant */
        $merchant = $request->user();
        $croppingSeason = $validated['cropping_season'] ?? '2026-WET';
        $beneficiaryId = trim($validated['beneficiary_id']);

        $farmer = User::where('role', 'farmer')
            ->where('beneficiary_id', $beneficiaryId)
            ->first();

        if (!$farmer) {
            return response()->json([
                'status' => 'error',
                'error_code' => 'INVALID_BENEFICIARY_ID',
                'message' => 'Beneficiary ID not found in the National Farmer Registry.',
            ], 422);
        }

        return DB::transaction(function () use ($merchant, $farmer, $beneficiaryId, $croppingSeason, $validated) {
            $requestedItems = collect($validated['items']);
            $productIds = $requestedItems->pluck('product_id')->unique()->sort()->values()->all();

            $products = Product::where('merchant_id', $merchant->id)
                ->whereIn('id', $productIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $totalAmount = 0.0;
            $highNitrogenBagsRequested = 0;
            $lineItemsData = [];

            foreach ($requestedItems as $reqItem) {
                /** @var Product|null $product */
                $product = $products->get($reqItem['product_id']);
                if (!$product || !$product->is_active) {
                    return response()->json([
                        'status' => 'error',
                        'error_code' => 'PRODUCT_UNAVAILABLE',
                        'message' => "Selected product #{$reqItem['product_id']} is not active in merchant inventory.",
                    ], 422);
                }

                $qty = (int) $reqItem['quantity'];
                if ($qty > $product->stock_quantity) {
                    return response()->json([
                        'status' => 'error',
                        'error_code' => 'INSUFFICIENT_STOCK',
                        'message' => "Insufficient stock for {$product->name}. Available: {$product->stock_quantity}, Requested: {$qty}.",
                    ], 422);
                }

                if ($product->is_high_nitrogen) {
                    $highNitrogenBagsRequested += $qty;
                }

                $unitPrice = (float) $product->unit_price;
                $subtotal = round($unitPrice * $qty, 2);
                $totalAmount = round($totalAmount + $subtotal, 2);

                $lineItemsData[] = [
                    'product_id' => $product->id,
                    'product_name' => $product->name,
                    'category' => $product->category,
                    'is_high_nitrogen' => $product->is_high_nitrogen,
                    'quantity' => $qty,
                    'unit_price' => $unitPrice,
                    'subtotal' => $subtotal,
                ];
            }

            // Module 5 Option A — Enforce High-Nitrogen Fertilizer Subsidy Quota (Max 5 bags per cropping season)
            $maxQuota = $this->settlementService->getMaxHighNitrogenQuota();
            $alreadyUsed = $this->settlementService->getFarmerSeasonHighNitrogenUsed($farmer->id, $croppingSeason);

            if (($alreadyUsed + $highNitrogenBagsRequested) > $maxQuota) {
                $remaining = max(0, $maxQuota - $alreadyUsed);
                return response()->json([
                    'status' => 'error',
                    'error_code' => 'SUBSIDY_QUOTA_EXCEEDED',
                    'message' => "Subsidy Quota Exceeded: Each farmer is restricted to a maximum quota of {$maxQuota} bags of high-nitrogen fertilizer per cropping season ({$croppingSeason}). Farmer {$farmer->name} ({$farmer->beneficiary_id}) has already used {$alreadyUsed} bag(s) and can only purchase {$remaining} more bag(s) this season (requested {$highNitrogenBagsRequested} bag(s)).",
                    'quota_details' => [
                        'cropping_season' => $croppingSeason,
                        'max_bags' => $maxQuota,
                        'used_bags' => $alreadyUsed,
                        'requested_bags' => $highNitrogenBagsRequested,
                        'remaining_bags' => $remaining,
                    ],
                ], 422);
            }

            // Verify Farmer Subsidy Balance
            if ((float) $farmer->subsidy_balance < $totalAmount) {
                return response()->json([
                    'status' => 'error',
                    'error_code' => 'INSUFFICIENT_SUBSIDY_BALANCE',
                    'message' => sprintf(
                        'Order total (PHP %s) exceeds farmer allocated subsidy balance (PHP %s).',
                        number_format($totalAmount, 2),
                        number_format((float) $farmer->subsidy_balance, 2)
                    ),
                ], 422);
            }

            // Generate UUID, Timestamp, Composite Reference, and HMAC-SHA256 Signature
            $uuid = (string) Str::uuid();
            $timestamp = Carbon::now()->timestamp;
            $qrPayload = $this->qrService->createSignedPayload(
                $uuid,
                $beneficiaryId,
                $merchant->id,
                $totalAmount,
                $timestamp
            );

            $transaction = Transaction::create([
                'uuid' => $uuid,
                'reference_string' => $qrPayload['reference_string'],
                'merchant_id' => $merchant->id,
                'farmer_id' => $farmer->id,
                'beneficiary_id' => $beneficiaryId,
                'total_amount' => $totalAmount,
                'status' => 'pending',
                'qr_signature' => $qrPayload['signature'],
                'qr_timestamp' => $timestamp,
                'expires_at' => Carbon::parse($qrPayload['expires_at']),
                'cropping_season' => $croppingSeason,
            ]);

            foreach ($lineItemsData as $itemData) {
                TransactionItem::create(array_merge($itemData, [
                    'transaction_id' => $transaction->id,
                ]));
            }

            $transaction->load(['items', 'farmer', 'merchant']);

            return response()->json([
                'status' => 'success',
                'message' => 'Pending POS transaction and cryptographic QR payload generated.',
                'transaction' => $transaction,
                'qr_payload' => $qrPayload,
                'qr_json_string' => json_encode($qrPayload, JSON_UNESCAPED_SLASHES),
            ], 201);
        });
    }

    /**
     * List recent transactions for the Merchant POS dashboard.
     */
    public function transactions(Request $request): JsonResponse
    {
        /** @var User $merchant */
        $merchant = $request->user();

        $transactions = Transaction::with(['items', 'farmer', 'paymentLogs'])
            ->where('merchant_id', $merchant->id)
            ->orderByDesc('id')
            ->limit(25)
            ->get();

        return response()->json([
            'status' => 'success',
            'transactions' => $transactions,
        ]);
    }
}
