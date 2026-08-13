<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PppoeCustomer extends Model
{
    use HasFactory;

    protected $table = 'pppoe_customers';

    protected $guarded = [];

    protected $casts = [
        'activated_at' => 'datetime',
        'expires_at' => 'datetime',
        'last_recharged_at' => 'datetime',
        'contract_price' => 'decimal:2',
        'mac_bind' => 'boolean',
        'simultaneous_use' => 'integer',
    ];

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

    public function nasDevice(): BelongsTo
    {
        return $this->belongsTo(NasDevice::class, 'nas_device_id');
    }

    public function recharges(): HasMany
    {
        return $this->hasMany(PppoeRecharge::class, 'customer_id');
    }
}
