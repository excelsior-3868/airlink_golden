<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class BrandingSetting extends Model
{
    use HasFactory;

    protected $fillable = [
        'property_name',
        'primary_color',
        'logo_url',
        'official_email',
        'support_phone',
        'registered_address',
        'pan_vat_number',
    ];
}
