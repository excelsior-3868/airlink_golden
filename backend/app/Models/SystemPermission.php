<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SystemPermission extends Model
{
    protected $fillable = [
        'feature',
        'display_name',
        'category',
        'description',
        'admin',
        'reseller',
        'seller',
    ];

    protected $casts = [
        'admin' => 'boolean',
        'reseller' => 'boolean',
        'seller' => 'boolean',
    ];

    /**
     * In-memory cache: feature => SystemPermission|null
     * Populated on first access per feature; avoids repeated DB hits within the
     * same request when validateData() calls isAllowed() multiple times.
     *
     * @var array<string, SystemPermission|null>
     */
    private static array $cache = [];

    /**
     * Check if a role is allowed to perform this feature.
     * Results are cached in-memory for the duration of the current request.
     */
    public static function isAllowed(string $feature, string $role): bool
    {
        if (!array_key_exists($feature, self::$cache)) {
            self::$cache[$feature] = self::where('feature', $feature)->first();
        }

        $perm = self::$cache[$feature];

        if (!$perm) {
            // Default fallbacks if permission record is missing
            if ($role === 'admin') return true;
            if ($role === 'reseller' && in_array($feature, ['allocate_gb', 'create_seller', 'generate_voucher', 'dashboard', 'reports', 'view_plans', 'view_sellers', 'view_transactions'])) return true;
            if ($role === 'seller' && in_array($feature, ['generate_voucher', 'dashboard', 'reports', 'view_plans', 'view_transactions'])) return true;
            if ($feature === 'generate_voucher' || $feature === 'dashboard') return true;
            return false;
        }

        return (bool) $perm->getAttribute($role);
    }

    /**
     * Flush the in-memory cache (useful after seeding or in tests).
     */
    public static function flushCache(): void
    {
        self::$cache = [];
    }
}
