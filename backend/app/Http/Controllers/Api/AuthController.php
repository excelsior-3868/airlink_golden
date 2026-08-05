<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('username', $data['username'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            LoginLog::create([
                'user_id' => $user?->id, 'username' => $data['username'],
                'ip_address' => $request->ip(), 'user_agent' => $request->userAgent(),
                'successful' => false, 'created_at' => now(),
            ]);

            return $this->fail('Invalid username or password.', 401);
        }

        if ($user->status !== 'active') {
            return $this->fail('Your account is disabled.', 403);
        }

        LoginLog::create([
            'user_id' => $user->id, 'username' => $user->username,
            'ip_address' => $request->ip(), 'user_agent' => $request->userAgent(),
            'successful' => true, 'created_at' => now(),
        ]);

        $token = $user->createToken('portal')->plainTextToken;

        return $this->ok([
            'token' => $token,
            'user' => $this->userPayload($user),
        ], 'Logged in.');
    }

    public function me(Request $request): JsonResponse
    {
        return $this->ok($this->userPayload($request->user()));
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return $this->ok(null, 'Logged out.');
    }

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'new_password' => ['required', 'string', 'min:6', 'confirmed'],
        ]);

        $user = $request->user();

        if (! Hash::check($data['current_password'], $user->password)) {
            return $this->fail('The current password you entered is incorrect.', 422);
        }

        $user->update([
            'password' => Hash::make($data['new_password']),
            'must_reset_password' => false,
        ]);

        return $this->ok(null, 'Password changed successfully.');
    }

    private function userPayload(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username,
            'email' => $user->email,
            'role' => $user->role,
            'parent_id' => $user->parent_id,
            'wallet_balance' => $user->wallet_balance,
            'gb_balance' => $user->gb_balance,
            'gb_reserved' => $user->gb_reserved,
            'gb_allowable' => $user->gb_allowable,
            'status' => $user->status,
            'must_reset_password' => $user->must_reset_password,
            'permissions' => $this->permissionsFor($user),
        ];
    }

    /**
     * Effective permission map for the user's role: feature => bool.
     * Drives frontend menu/route visibility so the UI matches server-side gating.
     */
    private function permissionsFor(User $user): array
    {
        return SystemPermission::all()
            ->mapWithKeys(fn (SystemPermission $p) => [$p->feature => (bool) $p->getAttribute($user->role)])
            ->all();
    }
}
