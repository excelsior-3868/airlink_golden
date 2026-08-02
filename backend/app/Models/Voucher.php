<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Voucher extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'data_gb' => 'decimal:3',
            'price' => 'decimal:2',
            'base_price' => 'decimal:2',
            'commission_percent' => 'decimal:2',
            'admin_share' => 'decimal:2',
            'reseller_share' => 'decimal:2',
            'gb_cost' => 'decimal:3',
            'gb_due_amount' => 'decimal:2',
            'sold_at' => 'datetime',
            'activated_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(InternetPlan::class, 'plan_id');
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(Batch::class);
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function reseller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reseller_id');
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'seller_id');
    }
}
