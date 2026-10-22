<?php

namespace Database\Seeders;

use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // 1. Seed Accredited Merchant Account
        $merchant = User::updateOrCreate(
            ['email' => 'merchant@fds.gov.ph'],
            [
                'name' => 'Maria Clara Agro-Supply',
                'password' => Hash::make('password123'),
                'role' => 'merchant',
                'beneficiary_id' => null,
                'store_name' => 'GreenHarvest Accredited Agri-Trading POS #042',
                'region' => 'Region III - Central Luzon (Nueva Ecija)',
                'subsidy_balance' => 0.00,
                'wallet_balance' => 25000.00,
            ]
        );

        // 2. Seed Registry-Verified Farmer Accounts
        User::updateOrCreate(
            ['email' => 'farmer@fds.gov.ph'],
            [
                'name' => 'Juan Dela Cruz',
                'password' => Hash::make('password123'),
                'role' => 'farmer',
                'beneficiary_id' => 'RSBSA-03-2026-00142',
                'store_name' => null,
                'region' => 'Region III - Central Luzon (Cabanatuan)',
                'subsidy_balance' => 15000.00,
                'wallet_balance' => 0.00,
            ]
        );

        User::updateOrCreate(
            ['email' => 'farmer2@fds.gov.ph'],
            [
                'name' => 'Pedro Penduko',
                'password' => Hash::make('password123'),
                'role' => 'farmer',
                'beneficiary_id' => 'RSBSA-03-2026-00889',
                'store_name' => null,
                'region' => 'Region III - Central Luzon (Tarlac)',
                'subsidy_balance' => 12500.00,
                'wallet_balance' => 0.00,
            ]
        );

        // 3. Seed Active Fertilizer Products for Merchant
        $products = [
            [
                'sku' => 'FERT-UREA-4600',
                'name' => 'Granular Prilled Urea (46-0-0)',
                'description' => 'High-nitrogen synthetic fertilizer for rapid vegetative crop growth during early tillering.',
                'category' => 'high_nitrogen',
                'npk_ratio' => '46-0-0',
                'is_high_nitrogen' => true,
                'unit' => '50kg Bag',
                'unit_price' => 1650.00,
                'stock_quantity' => 45,
                'is_active' => true,
            ],
            [
                'sku' => 'FERT-AMMOSUL-2100',
                'name' => 'Ammonium Sulfate + Sulfur (21-0-0-24S)',
                'description' => 'Nitrogen-rich crystalline fertilizer with essential sulfur for alkaline paddy soils.',
                'category' => 'high_nitrogen',
                'npk_ratio' => '21-0-0',
                'is_high_nitrogen' => true,
                'unit' => '50kg Bag',
                'unit_price' => 1150.00,
                'stock_quantity' => 30,
                'is_active' => true,
            ],
            [
                'sku' => 'FERT-COMPLETE-141414',
                'name' => 'Complete Balanced NPK (14-14-14)',
                'description' => 'Balanced nitrogen, phosphorus, and potassium basal fertilizer for uniform root and shoot development.',
                'category' => 'balanced_npk',
                'npk_ratio' => '14-14-14',
                'is_high_nitrogen' => false,
                'unit' => '50kg Bag',
                'unit_price' => 1480.00,
                'stock_quantity' => 60,
                'is_active' => true,
            ],
            [
                'sku' => 'FERT-DAP-18460',
                'name' => 'Diammonium Phosphate DAP (18-46-0)',
                'description' => 'High-phosphorus starter blend for vigorous root establishment and flowering.',
                'category' => 'potash_phosphate',
                'npk_ratio' => '18-46-0',
                'is_high_nitrogen' => false,
                'unit' => '50kg Bag',
                'unit_price' => 2100.00,
                'stock_quantity' => 25,
                'is_active' => true,
            ],
            [
                'sku' => 'FERT-MOP-0060',
                'name' => 'Muriate of Potash MOP (0-0-60)',
                'description' => 'Potassium-rich grain-filling enhancer that improves drought resistance and panicle weight.',
                'category' => 'potash_phosphate',
                'npk_ratio' => '0-0-60',
                'is_high_nitrogen' => false,
                'unit' => '50kg Bag',
                'unit_price' => 1750.00,
                'stock_quantity' => 8,
                'is_active' => true,
            ],
            [
                'sku' => 'FERT-VERMI-ORG',
                'name' => 'Bio-Enriched Vermicompost Organic Blend',
                'description' => 'Certified organic soil conditioner enriched with Trichoderma and beneficial microbes.',
                'category' => 'organic',
                'npk_ratio' => '5-5-5',
                'is_high_nitrogen' => false,
                'unit' => '50kg Bag',
                'unit_price' => 650.00,
                'stock_quantity' => 3,
                'is_active' => true,
            ],
        ];

        foreach ($products as $prod) {
            Product::updateOrCreate(
                ['sku' => $prod['sku']],
                array_merge($prod, ['merchant_id' => $merchant->id])
            );
        }
    }
}
