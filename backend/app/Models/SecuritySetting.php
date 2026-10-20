<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SecuritySetting extends Model
{
    /** Roles TOTP can currently be required for. Widen (e.g. add 'reseller') to roll out further. */
    public const TOTP_ELIGIBLE_ROLES = ['admin'];

    protected $fillable = ['totp_required_roles'];

    protected $casts = ['totp_required_roles' => 'array'];

    public static function current(): self
    {
        return static::firstOrCreate(['id' => 1], ['totp_required_roles' => []]);
    }

    /** Roles that must use TOTP, limited to the eligible ones. */
    public static function requiredRoles(): array
    {
        return array_values(array_intersect(self::current()->totp_required_roles ?? [], self::TOTP_ELIGIBLE_ROLES));
    }
}
