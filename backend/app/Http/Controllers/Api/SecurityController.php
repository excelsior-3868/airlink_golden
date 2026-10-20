<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SecuritySetting;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Admin-only: which roles must use TOTP, and resetting a user's authenticator. */
class SecurityController extends Controller
{
    public function totp(): JsonResponse
    {
        return $this->ok($this->state());
    }

    public function updateTotp(Request $request): JsonResponse
    {
        $data = $request->validate([
            'required_roles' => ['present', 'array'],
            'required_roles.*' => ['string', Rule::in(SecuritySetting::TOTP_ELIGIBLE_ROLES)],
        ]);

        SecuritySetting::current()->update(['totp_required_roles' => array_values(array_unique($data['required_roles']))]);

        return $this->ok($this->state(), 'Two-factor settings saved.');
    }

    /** Clears a user's authenticator (lost phone) and ends their portal sessions. */
    public function resetUserTotp(User $user): JsonResponse
    {
        $user->forceFill([
            'totp_secret' => null,
            'totp_confirmed_at' => null,
            'totp_recovery_codes' => null,
            'totp_last_step' => null,
        ])->save();
        $user->tokens()->where('name', 'portal')->delete();

        return $this->ok($this->state(), "Two-factor reset for {$user->username}.");
    }

    private function state(): array
    {
        return [
            'required_roles' => SecuritySetting::requiredRoles(),
            'eligible_roles' => SecuritySetting::TOTP_ELIGIBLE_ROLES,
            'enrolled_users' => User::whereNotNull('totp_confirmed_at')
                ->orderBy('username')
                ->get(['id', 'name', 'username', 'role', 'totp_confirmed_at']),
        ];
    }
}
