<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\IntegrationTokenAbilities;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Lets a logged-in admin/reseller/seller create a named, ability-scoped Sanctum personal access
 * token for a third-party integration (e.g. "Trekkers Inn"), list tokens, and revoke one. No new
 * Eloquent model — this is pure Sanctum (User already `use HasApiTokens`), see
 * database/migrations/2026_07_11_134510_create_personal_access_tokens_table.php.
 *
 * Mapping which reseller/seller account a third-party app is bound to is an ADMIN-ONLY action:
 * only an admin may pass `user_id` to create a token under a DIFFERENT account (store() below).
 * A reseller/seller can still create a token for themselves (no `user_id`), but cannot create
 * one on behalf of anyone else.
 */
class IntegrationTokenController extends Controller
{
    /**
     * List integration tokens. Admin sees every token system-wide (with owner info, so they can
     * see/manage what's bound to which reseller/seller) — anyone else sees only their own.
     * Never returns the plaintext token.
     */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();

        $query = $actor->isAdmin()
            ? PersonalAccessToken::query()->with('tokenable:id,name,username,role')
            : $actor->tokens();

        $tokens = $query->orderByDesc('created_at')->get()
            ->map(fn ($t) => [
                'id' => $t->id,
                'name' => $t->name,
                'abilities' => $t->abilities,
                'last_used_at' => $t->last_used_at,
                'created_at' => $t->created_at,
                'owner' => $actor->isAdmin() && $t->tokenable ? [
                    'id' => $t->tokenable->id,
                    'name' => $t->tokenable->name,
                    'username' => $t->tokenable->username,
                    'role' => $t->tokenable->role,
                ] : null,
            ]);

        return $this->ok($tokens);
    }

    /**
     * Create a token. The plaintext value is returned ONLY in this response — Sanctum stores
     * just a hash, so it can never be shown again after this.
     *
     * `user_id`: admin-only — creates the token under that reseller/seller's account instead of
     * the admin's own, i.e. this is how an admin binds a third-party integration to a specific
     * downline account. Omit it to create a token for yourself (any role may do this).
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'abilities' => ['nullable', 'array'],
            'abilities.*' => ['string', 'in:' . implode(',', array_keys(IntegrationTokenAbilities::ALL))],
            'user_id' => ['nullable', 'integer', 'exists:users,id'],
        ]);

        $owner = $request->user();

        if (! empty($data['user_id'])) {
            if (! $owner->isAdmin()) {
                return $this->fail('Only an admin can create a token for another account.', 403);
            }

            $target = User::findOrFail($data['user_id']);
            if (! in_array($target->role, ['reseller', 'seller'], true)) {
                return $this->fail('Tokens can only be bound to a reseller or seller account.', 422);
            }

            $owner = $target;
        }

        $abilities = $data['abilities'] ?? array_keys(IntegrationTokenAbilities::ALL);
        $token = $owner->createToken($data['name'], $abilities);

        return $this->created([
            'id' => $token->accessToken->id,
            'name' => $token->accessToken->name,
            'abilities' => $token->accessToken->abilities,
            'created_at' => $token->accessToken->created_at,
            'token' => $token->plainTextToken,
            'owner' => ['id' => $owner->id, 'name' => $owner->name, 'username' => $owner->username, 'role' => $owner->role],
        ], 'API token created.');
    }

    /** Revoke a token — admin may revoke ANY token; anyone else only their own. */
    public function destroy(Request $request, int $id): JsonResponse
    {
        $actor = $request->user();

        $deleted = $actor->isAdmin()
            ? PersonalAccessToken::where('id', $id)->delete()
            : $actor->tokens()->where('id', $id)->delete();

        if (! $deleted) {
            return $this->fail('Token not found.', 404);
        }

        return $this->ok(null, 'API token revoked.');
    }

    /** The curated ability catalog, for the frontend's create-token checkboxes. */
    public function abilities(): JsonResponse
    {
        return $this->ok(IntegrationTokenAbilities::ALL);
    }
}
