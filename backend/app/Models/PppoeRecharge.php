<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PppoeRecharge extends Model
{
    use HasFactory;

    protected $table = 'pppoe_recharges';

    protected $guarded = [];

    protected $casts = [
        'price' => 'decimal:2',
        'base_price' => 'decimal:2',
        'commission_percent' => 'decimal:2',
        'admin_share' => 'decimal:2',
        'reseller_share' => 'decimal:2',
        'validity_days' => 'integer',
        'period_start' => 'datetime',
        'period_end' => 'datetime',
    ];

    public function customer(): BelongsTo
    {
        return $this->belongsTo(PppoeCustomer::class, 'customer_id');
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(InternetPlan::class, 'plan_id');
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function reseller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reseller_id');
    }

    public function collectedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'collected_by');
    }
}
