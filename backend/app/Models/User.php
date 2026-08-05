<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable([
    'name', 'username', 'email', 'phone', 'password', 'role', 'parent_id',
    'wallet_balance', 'wallet_due', 'gb_balance', 'gb_rate', 'commission_percent', 'status', 'created_by',
    'must_reset_password', 'legacy_id', 'legacy_username',
])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'wallet_balance' => 'decimal:2',
            'wallet_due' => 'decimal:2',
            'gb_balance' => 'decimal:3',
            'gb_rate' => 'decimal:2',
            'commission_percent' => 'decimal:2',
            'commission_due' => 'decimal:2',
            'must_reset_password' => 'boolean',
        ];
    }

    // --- Role helpers ---
    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    public function isReseller(): bool
    {
        return $this->role === 'reseller';
    }

    public function isSeller(): bool
    {
        return $this->role === 'seller';
    }

    // --- Hierarchy ---
    public function parent(): BelongsTo
    {
        return $this->belongsTo(User::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(User::class, 'parent_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    // --- Balances / activity ---
    public function walletTransactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class);
    }

    public function gbTransactions(): HasMany
    {
        return $this->hasMany(GbTransaction::class);
    }

    public function vouchers(): HasMany
    {
        return $this->hasMany(Voucher::class, 'owner_id');
    }

    /**
     * The role this user is allowed to create beneath them, or null.
     * Admin → reseller; reseller → seller; seller → none.
     */
    public function creatableChildRole(): ?string
    {
        return match ($this->role) {
            'admin' => 'reseller',
            'reseller' => 'seller',
            default => null,
        };
    }

    /**
     * Restrict a users query to what $actor may see:
     * admin → everyone; reseller → self + own sellers; seller → self only.
     */
    public function scopeVisibleTo($query, User $actor)
    {
        if ($actor->isAdmin()) {
            return $query;
        }
        if ($actor->isReseller()) {
            return $query->where(fn ($q) => $q->where('parent_id', $actor->id)->orWhere('id', $actor->id));
        }

        return $query->where('id', $actor->id);
    }

    /** True if $actor may act on / view this user. */
    public function isManagedBy(User $actor): bool
    {
        return $actor->isAdmin()
            || $this->id === $actor->id
            || $this->parent_id === $actor->id;
    }

    public function getGbReservedAttribute(): float
    {
        return (float) Voucher::where('owner_id', $this->id)
            ->where('status', 'active')
            ->whereNotNull('gb_cost')
            ->sum('gb_cost');
    }

    public function getGbAllowableAttribute(): float
    {
        return max(0.000, (float) $this->gb_balance - $this->getGbReservedAttribute());
    }
}
