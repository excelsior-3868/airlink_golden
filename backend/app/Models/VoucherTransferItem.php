<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VoucherTransferItem extends Model
{
    protected $guarded = [];

    public function transfer(): BelongsTo
    {
        return $this->belongsTo(VoucherTransfer::class, 'voucher_transfer_id');
    }

    public function voucher(): BelongsTo
    {
        return $this->belongsTo(Voucher::class);
    }
}
