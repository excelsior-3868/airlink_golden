<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InternetPlan extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'data_gb' => 'decimal:3',
            'base_price' => 'decimal:2',
            'selling_price' => 'decimal:2',
        ];
    }

    public function vouchers(): HasMany
    {
        return $this->hasMany(Voucher::class, 'plan_id');
    }

    public function bandwidthRef(): BelongsTo
    {
        return $this->belongsTo(Bandwidth::class, 'bandwidth_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function nasDevice(): BelongsTo
    {
        return $this->belongsTo(NasDevice::class, 'nas_device_id');
    }

    public function pppoeCustomers(): HasMany
    {
        return $this->hasMany(PppoeCustomer::class, 'plan_id');
    }
}
