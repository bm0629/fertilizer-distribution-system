<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Product extends Model
{
    use HasFactory;

    protected $fillable = [
        'merchant_id',
        'sku',
        'name',
        'description',
        'category',
        'npk_ratio',
        'is_high_nitrogen',
        'unit',
        'unit_price',
        'stock_quantity',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'is_high_nitrogen' => 'boolean',
            'unit_price' => 'decimal:2',
            'stock_quantity' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function merchant(): BelongsTo
    {
        return $this->belongsTo(User::class, 'merchant_id');
    }
}
