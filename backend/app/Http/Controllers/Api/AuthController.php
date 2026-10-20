<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LoginLog;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use App\Models\SecuritySetting;
use App\Services\Totp;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

class AuthController extends Controller
{
    public function recaptchaConfig(): JsonResponse
    {
        $enabled = config('services.recaptcha.site_key') && config('services.recaptcha.secret_key');

        return $this->ok(['site_key' => $enabled ? config('services.recaptcha.site_key') : null]);
    }

    /** Verifies a reCAPTCHA v3 token with Google. Always passes when reCAPTCHA isn't configured. */
    private function recaptchaPasses(?string $token, ?string $ip): bool
    {
        $secret = config('services.recaptcha.secret_key');
        if (! $secret || ! config('services.recaptcha.site_key')) {
            return true;
        }
        if (! $token) {
            return false;
        }

        try {
            $res = Http::asForm()->timeout(8)->post('https://www.google.com/recaptcha/api/siteverify', [
                'secret' => $secret, 'response' => $token, 'remoteip' => $ip,
            ])->json();
        } catch (\Throwable $e) {
            report($e);

            return false;
        }

        return ($res['success'] ?? false)
            && ($res['action'] ?? 'login') === 'login'
            && ($res['score'] ?? 0) >= config('services.recaptcha.min_score');
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string'],
            'password' => ['required', 'string'],
            'recaptcha_token' => ['nullable', 'string'],
        ]);

        if (! $this->recaptchaPasses($data['recaptcha_token'] ?? null, $request->ip())) {
            return $this->fail('reCAPTCHA verification failed. Please try again.', 422);
        }

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

        if ($this->needsTwoFactor($user)) {
            $challenge = Str::random(48);
            Cache::put(self::challengeKey($challenge), ['user_id' => $user->id, 'attempts' => 0], now()->addMinutes(5));

            return $this->ok([
                'requires_2fa' => true,
                'challenge' => $challenge,
                'enroll_required' => $user->totp_confirmed_at === null,
            ], 'Two-factor verification required.');
        }

        return $this->issueLogin($user, $request);
    }

    private function issueLogin(User $user, Request $request): JsonResponse
    {
        LoginLog::create([
            'user_id' => $user->id, 'username' => $user->username,
            'ip_address' => $request->ip(), 'user_agent' => $request->userAgent(),
            'successful' => true, 'created_at' => now(),
        ]);

        $token = $user->createToken('portal', ['*'], now()->addHours(12))->plainTextToken;

        return $this->ok([
            'token' => $token,
            'user' => $this->userPayload($user),
        ], 'Logged in.');
    }

    // --- Two-factor (TOTP) ---

    private function needsTwoFactor(User $user): bool
    {
        return $user->totp_confirmed_at !== null
            || in_array($user->role, SecuritySetting::requiredRoles(), true);
    }

    private static function challengeKey(string $challenge): string
    {
        return 'login2fa:' . hash('sha256', $challenge);
    }

    /** @return array{0: User, 1: string}|JsonResponse user + cache key, or an error response */
    private function resolveChallenge(Request $request, bool $countAttempt)
    {
        $challenge = (string) $request->input('challenge');
        $key = self::challengeKey($challenge);
        $data = $challenge !== '' ? Cache::get($key) : null;
        $user = $data ? User::find($data['user_id']) : null;

        if (! $data || ! $user || $user->status !== 'active') {
            return $this->fail('Your sign-in session expired. Please log in again.', 401);
        }
        if ($countAttempt) {
            $data['attempts']++;
            if ($data['attempts'] > 5) {
                Cache::forget($key);

                return $this->fail('Too many incorrect codes. Please log in again.', 429);
            }
            Cache::put($key, $data, now()->addMinutes(5));
        }

        return [$user, $key];
    }

    /** First-time enrolment: returns the secret and otpauth URI (reused until confirmed). */
    public function twoFactorSetup(Request $request): JsonResponse
    {
        $request->validate(['challenge' => ['required', 'string']]);
        $resolved = $this->resolveChallenge($request, false);
        if ($resolved instanceof JsonResponse) {
            return $resolved;
        }
        [$user] = $resolved;

        if ($user->totp_confirmed_at !== null) {
            return $this->fail('Two-factor authentication is already set up for this account.', 422);
        }
        if (! $user->totp_secret) {
            $user->forceFill(['totp_secret' => Totp::generateSecret()])->save();
        }

        return $this->ok([
            'secret' => $user->totp_secret,
            'otpauth_uri' => Totp::uri($user->totp_secret, $user->username, config('app.name', 'Airlink')),
        ]);
    }

    /** Verifies the code (or a recovery code) and completes the login. */
    public function twoFactorVerify(Request $request): JsonResponse
    {
        $data = $request->validate([
            'challenge' => ['required', 'string'],
            'code' => ['required', 'string', 'max:32'],
        ]);
        $resolved = $this->resolveChallenge($request, true);
        if ($resolved instanceof JsonResponse) {
            return $resolved;
        }
        [$user, $key] = $resolved;

        $enrolling = $user->totp_confirmed_at === null;
        if ($enrolling && ! $user->totp_secret) {
            return $this->fail('Start two-factor setup first.', 422);
        }

        $ok = false;
        $step = Totp::verify($user->totp_secret ?? '', $data['code']);
        if ($step !== null && ($user->totp_last_step === null || $step > $user->totp_last_step)) {
            $user->forceFill(['totp_last_step' => $step]);
            $ok = true;
        } elseif (! $enrolling && $this->consumeRecoveryCode($user, $data['code'])) {
            $ok = true;
        }

        if (! $ok) {
            LoginLog::create([
                'user_id' => $user->id, 'username' => $user->username,
                'ip_address' => $request->ip(), 'user_agent' => $request->userAgent(),
                'successful' => false, 'created_at' => now(),
            ]);

            return $this->fail('Invalid authentication code.', 422);
        }

        $recovery = null;
        if ($enrolling) {
            $recovery = $this->generateRecoveryCodes($user);
            $user->forceFill(['totp_confirmed_at' => now()]);
        }
        $user->save();
        Cache::forget($key);

        $response = $this->issueLogin($user, $request);
        if ($recovery) {
            $payload = $response->getData(true);
            $payload['data']['recovery_codes'] = $recovery;
            $response->setData($payload);
        }

        return $response;
    }

    private function recoveryHash(string $code): string
    {
        return hash_hmac('sha256', strtolower(str_replace(['-', ' '], '', $code)), (string) config('app.key'));
    }

    /** Replaces the user's recovery codes; returns the plaintext list (shown once). */
    private function generateRecoveryCodes(User $user): array
    {
        $plain = [];
        for ($i = 0; $i < 10; $i++) {
            $raw = bin2hex(random_bytes(5));
            $plain[] = substr($raw, 0, 5) . '-' . substr($raw, 5);
        }
        $user->forceFill(['totp_recovery_codes' => json_encode(array_map(fn ($c) => $this->recoveryHash($c), $plain))]);

        return $plain;
    }

    private function consumeRecoveryCode(User $user, string $code): bool
    {
        $hashes = json_decode((string) $user->totp_recovery_codes, true) ?: [];
        $hash = $this->recoveryHash($code);
        foreach ($hashes as $i => $h) {
            if (hash_equals($h, $hash)) {
                unset($hashes[$i]);
                $user->forceFill(['totp_recovery_codes' => json_encode(array_values($hashes))]);

                return true;
            }
        }

        return false;
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
            'new_password' => ['required', 'string', Password::min(10)->letters()->numbers(), 'confirmed'],
        ]);

        $user = $request->user();

        if (! Hash::check($data['current_password'], $user->password)) {
            return $this->fail('The current password you entered is incorrect.', 422);
        }

        $user->update([
            'password' => Hash::make($data['new_password']),
            'must_reset_password' => false,
        ]);

        // A password change must end every other session, not just rotate the hash.
        $user->tokens()->where('name', 'portal')->where('id', '!=', $user->currentAccessToken()->id)->delete();

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
            'totp_enabled' => $user->totp_confirmed_at !== null,
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
