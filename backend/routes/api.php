<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\FarmerCheckoutController;
use App\Http\Controllers\Api\MerchantPosController;
use App\Http\Controllers\Api\MerchantWithdrawalController;
use App\Http\Controllers\Api\PaymentWebhookController;
use Illuminate\Support\Facades\Route;

// Public Authentication & Demo Account Endpoints
Route::post('/auth/login', [AuthController::class, 'login']);
Route::get('/auth/demo-accounts', [AuthController::class, 'demoAccounts']);

// Public Asynchronous Payment Gateway Webhook Endpoint (Path A of Dual-Path Settlement)
Route::post('/webhooks/payment', [PaymentWebhookController::class, 'handleWebhook']);

// Authenticated Multi-Role Endpoints
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    // Accredited Merchant Role-Scoped Endpoints
    Route::middleware('role:merchant')->prefix('merchant')->group(function () {
        Route::get('/products', [MerchantPosController::class, 'products']);
        Route::post('/products', [MerchantPosController::class, 'storeProduct']);
        Route::patch('/products/{id}', [MerchantPosController::class, 'updateProduct']);
        Route::get('/beneficiaries/verify', [MerchantPosController::class, 'verifyBeneficiary']);
        Route::post('/transactions', [MerchantPosController::class, 'createTransaction']);
        Route::get('/transactions', [MerchantPosController::class, 'transactions']);

        // Module 5 Option C: Merchant Earnings Wallet & Payout Validator
        Route::get('/withdrawals', [MerchantWithdrawalController::class, 'index']);
        Route::post('/withdrawals', [MerchantWithdrawalController::class, 'store']);
    });

    // Registry-Verified Farmer Role-Scoped Endpoints
    Route::middleware('role:farmer')->prefix('farmer')->group(function () {
        Route::post('/qr/scan', [FarmerCheckoutController::class, 'scanQr']);
        Route::post('/transactions/{uuid}/checkout', [FarmerCheckoutController::class, 'createCheckoutSession']);
        Route::get('/transactions/{uuid}/poll', [FarmerCheckoutController::class, 'pollTransactionStatus']);
        Route::post('/transactions/{uuid}/cancel', [FarmerCheckoutController::class, 'cancelTransaction']);
        Route::get('/transactions', [FarmerCheckoutController::class, 'transactions']);
    });
});
