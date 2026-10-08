<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SystemLoad;
use App\Models\BrandingSetting;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    /** List users within the actor's subtree; optional ?role= filter, search, status, parent_id. */
    public function index(Request $request): JsonResponse
    {
        $actor = $request->user();
        $query = User::query()->visibleTo($actor)->where('id', '!=', $actor->id);

        if ($role = $request->query('role')) {
            $query->where('role', $role);
        }

        if ($status = $request->query('status')) {
            if (in_array($status, ['active', 'disabled'], true)) {
                $query->where('status', $status);
            }
        }

        if ($parentId = $request->query('reseller_id') ?? $request->query('parent_id')) {
            $query->where('parent_id', $parentId);
        }

        if ($userId = $request->query('id') ?? $request->query('user_id')) {
            $query->where('id', $userId);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                  ->orWhere('username', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhereHas('parent', function ($pq) use ($search) {
                      $pq->where('name', 'like', "%{$search}%")
                         ->orWhere('username', 'like', "%{$search}%");
                  });
            });
        }

        $perPage = $request->integer('per_page', 15);

        $users = $query->with('parent:id,name,username')
            ->withCount(['children', 'vouchers'])
            ->orderByDesc('id')
            ->paginate($perPage);

        return $this->ok($users);
    }

    public function show(Request $request, User $user): JsonResponse
    {
        if (! $user->isManagedBy($request->user())) {
            return $this->fail('Not found.', 404);
        }

        return $this->ok($user->loadCount('children'));
    }

    /** Admin creates a reseller (parented to the admin). */
    public function storeReseller(Request $request): JsonResponse
    {
        $data = $this->validateNewUser($request);
        // PPPoE-only installs have no voucher commission to set up front, so the
        // percent is optional there (it defaults to 0 on the users table).
        $pppoeOnly = (bool) BrandingSetting::find(1)?->pppoe_only;
        $validated = $request->validate([
            'commission_percent' => [$pppoeOnly ? 'nullable' : 'required', 'numeric', 'min:0', 'max:100'],
        ]);
        if (isset($validated['commission_percent'])) {
            $data['commission_percent'] = $validated['commission_percent'];
        }
        $admin = $request->user();

        $reseller = User::create($data + [
            'role' => 'reseller',
            'parent_id' => $admin->id,
            'created_by' => $admin->id,
            'status' => 'active',
        ]);

        return $this->created($reseller, 'Reseller created.');
    }

    /** Create a seller. Only resellers can create sellers, parented to themselves. */
    public function storeSeller(Request $request): JsonResponse
    {
        $actor = $request->user();

        if (! $actor->isReseller()) {
            return $this->fail('Only resellers can create sellers.', 403);
        }

        $data = $this->validateNewUser($request);

        $seller = User::create($data + [
            'role' => 'seller',
            'parent_id' => $actor->id,
            'created_by' => $actor->id,
            'status' => 'active',
        ]);

        return $this->created($seller, 'Seller created.');
    }

    /** Update reseller or seller information. */
    public function update(Request $request, User $user): JsonResponse
    {
        $actor = $request->user();
        if ($user->isSeller() && $actor->isAdmin()) {
            return $this->fail('Admins can only view sellers.', 403);
        }
        if (! $user->isManagedBy($actor)) {
            return $this->fail('You are not authorized to manage this user.', 403);
        }

        $rules = [
            'name' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:255', Rule::unique('users', 'username')->ignore($user->id)],
            'email' => ['nullable', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['nullable', 'string', 'min:6'],
        ];

        if ($actor->isAdmin()) {
            $rules['gb_rate'] = ['nullable', 'numeric', 'min:0.01'];
            if ($user->isReseller()) {
                $rules['commission_percent'] = ['nullable', 'numeric', 'min:0', 'max:100'];
            }
            if ($user->isSeller()) {
                $rules['parent_id'] = ['nullable', 'integer', Rule::exists('users', 'id')->where('role', 'reseller')];
            }
        }

        $data = $request->validate($rules);

        if (! empty($data['password'])) {
            $data['password'] = Hash::make($data['password']);
        } else {
            unset($data['password']);
        }

        if (! $actor->isAdmin()) {
            unset($data['gb_rate']);
            unset($data['parent_id']);
            unset($data['commission_percent']);
        }

        $user->update($data);

        return $this->ok($user->fresh(), 'User updated successfully.');
    }

    /** Enable/disable a user in the actor's subtree. */
    public function setStatus(Request $request, User $user): JsonResponse
    {
        $actor = $request->user();
        if ($user->isSeller() && $actor->isAdmin()) {
            return $this->fail('Admins can only view sellers.', 403);
        }
        if (! $user->isManagedBy($actor) || $user->id === $actor->id) {
            return $this->fail('You cannot change this user\'s status.', 403);
        }
        $data = $request->validate(['status' => ['required', 'in:active,disabled']]);
        $user->update(['status' => $data['status']]);

        return $this->ok($user, "User {$data['status']}.");
    }

    /** Update a user's GB rate (Admin only). */
    public function updateGbRate(Request $request, User $user): JsonResponse
    {
        if (! $request->user()->isAdmin()) {
            return $this->fail('Only Admins can change GB rates.', 403);
        }
        $data = $request->validate([
            'gb_rate' => ['required', 'numeric', 'min:0.01'],
        ]);
        $user->update(['gb_rate' => $data['gb_rate']]);

        return $this->ok($user, "GB rate updated successfully.");
    }

    /** System load of wallet and/or GB balance directly into the admin's account (Admin only). */
    public function systemLoad(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (! $actor->isAdmin()) {
            return $this->fail('Only Admins can perform system loads.', 403);
        }

        $data = $request->validate([
            'wallet_amount' => ['nullable', 'numeric', 'min:0'],
            'gb_amount' => ['nullable', 'numeric', 'min:0'],
            'note' => ['nullable', 'string', 'max:255'],
        ]);

        $walletAmount = (float) ($data['wallet_amount'] ?? 0);
        $gbAmount = (float) ($data['gb_amount'] ?? 0);
        $note = $data['note'] ?? 'System manual load';

        if ($walletAmount <= 0 && $gbAmount <= 0) {
            return $this->fail('Please provide a positive amount for wallet or GB balance.', 422);
        }

        \Illuminate\Support\Facades\DB::transaction(function () use ($actor, $walletAmount, $gbAmount, $note) {
            $user = User::whereKey($actor->id)->lockForUpdate()->first();

            if ($walletAmount > 0) {
                $user->increment('wallet_balance', $walletAmount);
                $user->refresh();
                \App\Models\WalletTransaction::create([
                    'user_id' => $user->id,
                    'type' => 'opening',
                    'amount' => $walletAmount,
                    'balance_after' => $user->wallet_balance,
                    'from_user_id' => $actor->id,
                    'note' => $note,
                    'reference' => 'system:load',
                ]);
            }

            if ($gbAmount > 0) {
                $user->increment('gb_balance', $gbAmount);
                $user->refresh();
                \App\Models\GbTransaction::create([
                    'user_id' => $user->id,
                    'type' => 'opening',
                    'gb_amount' => $gbAmount,
                    'balance_after' => $user->gb_balance,
                    'from_user_id' => $actor->id,
                    'reference' => 'system:load',
                    'note' => $note,
                ]);
            }

            SystemLoad::create([
                'user_id' => $user->id,
                'created_by' => $actor->id,
                'wallet_amount' => $walletAmount,
                'gb_amount' => $gbAmount,
                'wallet_balance_after' => $user->wallet_balance,
                'gb_balance_after' => $user->gb_balance,
                'note' => $note,
            ]);
        });

        return $this->ok(['user' => $actor->fresh()], 'System load successful.');
    }

    /** Fetch paginated system load history (Admin only). */
    public function systemLoadHistory(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (! $actor->isAdmin()) {
            return $this->fail('Only Admins can view system load history.', 403);
        }

        $query = SystemLoad::query()
            ->with([
                'user:id,name,username,role',
                'creator:id,name,username,role',
            ])
            ->latest();

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('note', 'like', "%{$search}%")
                  ->orWhereHas('creator', function ($cq) use ($search) {
                      $cq->where('name', 'like', "%{$search}%")
                         ->orWhere('username', 'like', "%{$search}%");
                  });
            });
        }

        $history = $query->paginate($request->integer('per_page', 20));

        return $this->ok($history);
    }

    private function validateNewUser(Request $request): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'username' => ['required', 'string', 'max:255', 'unique:users,username'],
            'email' => ['nullable', 'email', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:30'],
            'password' => ['required', 'string', 'min:6'],
            'gb_rate' => ['nullable', 'numeric', 'min:0.01'],
        ]);
        $data['password'] = Hash::make($data['password']);

        return $data;
    }
}
