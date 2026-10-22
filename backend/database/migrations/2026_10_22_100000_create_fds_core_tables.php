<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('merchant_id')->constrained('users')->cascadeOnDelete();
            $table->string('sku', 64)->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->enum('category', ['high_nitrogen', 'balanced_npk', 'organic', 'potash_phosphate'])->default('balanced_npk')->index();
            $table->string('npk_ratio', 32)->default('14-14-14');
            $table->boolean('is_high_nitrogen')->default(false)->index();
            $table->string('unit', 64)->default('50kg Bag');
            $table->decimal('unit_price', 12, 2);
            $table->unsignedInteger('stock_quantity')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('transactions', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('reference_string', 191)->unique();
            $table->foreignId('merchant_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('farmer_id')->constrained('users')->cascadeOnDelete();
            $table->string('beneficiary_id', 64)->index();
            $table->decimal('total_amount', 12, 2);
            $table->enum('status', ['pending', 'paid', 'failed', 'cancelled'])->default('pending')->index();
            $table->string('qr_signature', 128);
            $table->bigInteger('qr_timestamp');
            $table->timestamp('expires_at');
            $table->string('checkout_session_id', 128)->nullable()->unique();
            $table->string('cropping_season', 32)->default('2026-WET');
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
        });

        Schema::create('transaction_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('transaction_id')->constrained('transactions')->cascadeOnDelete();
            $table->foreignId('product_id')->constrained('products')->restrictOnDelete();
            $table->string('product_name');
            $table->string('category', 64);
            $table->boolean('is_high_nitrogen')->default(false);
            $table->unsignedInteger('quantity');
            $table->decimal('unit_price', 12, 2);
            $table->decimal('subtotal', 12, 2);
            $table->timestamps();
        });

        Schema::create('payment_logs', function (Blueprint $table) {
            $table->id();
            $table->string('event_id', 128)->unique();
            $table->foreignId('transaction_id')->constrained('transactions')->cascadeOnDelete();
            $table->string('event_type', 64);
            $table->enum('settlement_channel', ['webhook', 'polling_sync', 'gateway_direct'])->default('webhook');
            $table->decimal('amount', 12, 2);
            $table->string('status', 32);
            $table->json('payload_snapshot');
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('processed_at');
            $table->timestamps();
        });

        Schema::create('withdrawals', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('merchant_id')->constrained('users')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->enum('payout_method', ['bank_transfer', 'gcash', 'maya']);
            $table->string('provider_name', 64);
            $table->string('account_name', 128);
            $table->string('account_number', 64);
            $table->enum('status', ['pending', 'approved', 'completed', 'rejected'])->default('completed');
            $table->string('reference_number', 64)->unique();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('withdrawals');
        Schema::dropIfExists('payment_logs');
        Schema::dropIfExists('transaction_items');
        Schema::dropIfExists('transactions');
        Schema::dropIfExists('products');
    }
};
