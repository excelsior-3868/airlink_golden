<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SystemLoad extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'wallet_amount' => 'decimal:2',
            'gb_amount' => 'decimal:3',
            'wallet_balance_after' => 'decimal:2',
            'gb_balance_after' => 'decimal:3',
        ];
    }

    /** Target user receiving the system load. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** Admin user who executed the system load. */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
