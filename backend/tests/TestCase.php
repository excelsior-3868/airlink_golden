<?php

namespace Tests;

use App\Models\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\TransientToken;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /**
     * Hard guard: refuse to run tests against any database that is not clearly
     * a test DB. RefreshDatabase drops all tables, so a misconfigured
     * connection could wipe live data — abort loudly before that happens.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $db = DB::connection()->getDatabaseName();
        if (! str_contains((string) $db, 'test')) {
            throw new RuntimeException("Refusing to run tests against non-test database '{$db}'. Check phpunit.xml / DB_CONNECTION.");
        }

        // SystemPermission memoises lookups in a static array that outlives a
        // single test, while RefreshDatabase rebuilds the table under it. Left
        // alone, a miss cached by an earlier test makes a later one fall through
        // to the hardcoded fallbacks and answer 403 — so the suite passes or
        // fails depending on execution order.
        \App\Models\SystemPermission::flushCache();
    }

    /**
     * Plain actingAs() authenticates the user but attaches no access token, so
     * HasApiTokens::tokenCan() returns false for every ability and any endpoint
     * guarded by tokenCan() answers 403 — which is not how the app behaves.
     * AuthController::login issues the SPA a ['*'] token, so mirror that with a
     * TransientToken (can() === true for everything). Integration-token scoping
     * is exercised by creating a real token with explicit abilities instead.
     */
    public function actingAs(Authenticatable $user, $guard = null)
    {
        if ($guard === 'sanctum' && method_exists($user, 'withAccessToken')) {
            $user->withAccessToken(new TransientToken());
        }

        return parent::actingAs($user, $guard);
    }

    protected function makeUser(string $role, array $attrs = []): User
    {
        static $n = 0;
        $n++;

        return User::create(array_merge([
            'name' => ucfirst($role)." $n",
            'username' => "{$role}{$n}",
            'password' => Hash::make('password'),
            'role' => $role,
            'status' => 'active',
            'wallet_balance' => 0,
            'gb_balance' => 0,
        ], $attrs));
    }
}
