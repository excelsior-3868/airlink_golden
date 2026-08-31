<?php

namespace App\Services;

use App\Models\InternetPlan;
use App\Models\NasDevice;
use App\Models\PppoeCustomer;
use App\Models\User;
use App\Models\Voucher;
use App\Services\Radius\CoaService;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PppoeCustomerService
{
    public function __construct(
        private readonly PppoeRadiusService $radiusService,
        private readonly CoaService $coaService,
    ) {
    }

    /**
     * Create a new PPPoE subscriber in 'pending' status.
     * radcheck/radreply rows are NOT created until the first recharge.
     */
    public function create(User $actor, array $data): PppoeCustomer
    {
        $username = trim($data['username']);

        // Check uniqueness across both PPPoE customers and Voucher codes (Risk R4).
        // Void vouchers (e.g. legacy bad-import rows with no real credential) are
        // excluded from every voucher listing, so they must not block new usernames.
        if (PppoeCustomer::where('username', $username)->exists() || Voucher::where('code', $username)->whereNull('void_reason')->exists()) {
            throw ValidationException::withMessages([
                'username' => 'The username has already been taken.',
            ]);
        }

        $plan = InternetPlan::findOrFail($data['plan_id']);
        if ($plan->type !== 'pppoe') {
            throw ValidationException::withMessages([
                'plan_id' => 'The selected plan is not a PPPoE plan.',
            ]);
        }

        // Determine ownership
        $ownerId = $actor->id;
        $resellerId = null;

        if ($actor->isAdmin()) {
            if (!empty($data['owner_id'])) {
                $owner = User::findOrFail($data['owner_id']);
                $ownerId = $owner->id;
                if ($owner->isReseller()) {
                    $resellerId = $owner->id;
                }
            }
        } elseif ($actor->isReseller()) {
            $ownerId = $actor->id;
            $resellerId = $actor->id;
        }

        $nasIp = null;
        if (!empty($data['nas_device_id'])) {
            $nas = NasDevice::find($data['nas_device_id']);
            $nasIp = $nas?->nasname;
        }

        return DB::transaction(function () use ($data, $username, $plan, $ownerId, $resellerId, $nasIp) {
            $customer = PppoeCustomer::create([
                'username' => $username,
                'password' => $data['password'],
                'plan_id' => $plan->id,
                'owner_id' => $ownerId,
                'reseller_id' => $resellerId,
                'customer_code' => $data['customer_code'] ?? null,
                'full_name' => $data['full_name'],
                'phone' => $data['phone'] ?? null,
                'address' => $data['address'] ?? null,
                'notes' => $data['notes'] ?? null,
                'status' => 'pending',
                'activated_at' => null,
                'expires_at' => null,
                'last_recharged_at' => null,
                'bandwidth' => $data['bandwidth'] ?? null,
                'simultaneous_use' => $data['simultaneous_use'] ?? null,
                'contract_price' => $data['contract_price'] ?? null,
                'mac_bind' => (bool) ($data['mac_bind'] ?? false),
                'mac_address' => $data['mac_address'] ?? null,
                'nas_device_id' => $data['nas_device_id'] ?? null,
                'nas_ip' => $nasIp,
            ]);

            return $customer;
        });
    }

    /**
     * Update subscriber profile / credentials.
     */
    public function update(User $actor, PppoeCustomer $customer, array $data): PppoeCustomer
    {
        $oldPassword = $customer->password;
        $oldBandwidth = $customer->bandwidth;
        $oldPlanId = $customer->plan_id;
        $oldNasDeviceId = $customer->nas_device_id;

        if (isset($data['plan_id']) && $data['plan_id'] !== $customer->plan_id) {
            $plan = InternetPlan::findOrFail($data['plan_id']);
            if ($plan->type !== 'pppoe') {
                throw ValidationException::withMessages([
                    'plan_id' => 'The selected plan is not a PPPoE plan.',
                ]);
            }
        }

        if (isset($data['nas_device_id']) && $data['nas_device_id'] !== $customer->nas_device_id) {
            if (!empty($data['nas_device_id'])) {
                $nas = NasDevice::find($data['nas_device_id']);
                $data['nas_ip'] = $nas?->nasname;
            } else {
                $data['nas_ip'] = null;
            }
        }

        // Filter updatable attributes
        $fillable = [
            'full_name', 'phone', 'address', 'notes', 'customer_code',
            'contract_price', 'bandwidth', 'simultaneous_use', 'mac_bind',
            'mac_address', 'nas_device_id', 'nas_ip', 'plan_id'
        ];
        if (!empty($data['password'])) {
            $fillable[] = 'password';
        }

        $customer = DB::transaction(function () use ($customer, $data, $fillable) {
            $customer->update(array_intersect_key($data, array_flip($fillable)));

            // Rebuild radius rows if customer is active/suspended/expired (not pending or terminated)
            if (!in_array($customer->status, ['pending', 'terminated'])) {
                $this->rebuildRadiusRows($customer);
            }

            return $customer;
        });

        // If credentials/plan changed, disconnect any live session so new attributes apply
        $credentialsOrPlanChanged = (!empty($data['password']) && $data['password'] !== $oldPassword)
            || (isset($data['plan_id']) && $data['plan_id'] !== $oldPlanId)
            || (isset($data['bandwidth']) && $data['bandwidth'] !== $oldBandwidth)
            || (isset($data['nas_device_id']) && $data['nas_device_id'] !== $oldNasDeviceId);

        if ($credentialsOrPlanChanged) {
            try {
                $this->coaService->disconnectUsername($customer->username);
            } catch (\Throwable $e) {
                // Log and ignore CoA failure on update
            }
        }

        return $customer;
    }

    /**
     * Suspend a customer.
     * radcheck/radreply are deleted so the account can't re-authenticate —
     * no FreeRADIUS-side gate exists to reject on status alone. resume()
     * rebuilds these rows via rebuildRadiusRows().
     */
    public function suspend(User $actor, PppoeCustomer $customer): PppoeCustomer
    {
        DB::transaction(function () use ($customer) {
            $customer->update(['status' => 'suspended']);
            $this->deleteRadiusRows($customer->username);
        });

        try {
            $this->coaService->disconnectUsername($customer->username);
        } catch (\Throwable $e) {
            // Ignore CoA failure
        }

        return $customer;
    }

    /**
     * Resume a suspended customer.
     */
    public function resume(User $actor, PppoeCustomer $customer): PppoeCustomer
    {
        $newStatus = ($customer->expires_at && $customer->expires_at->isFuture()) ? 'active' : 'expired';
        $customer->update(['status' => $newStatus]);

        if (!in_array($customer->status, ['pending', 'terminated'])) {
            $this->rebuildRadiusRows($customer);
        }

        return $customer;
    }

    /**
     * Change a subscriber's plan.
     */
    public function changePlan(User $actor, PppoeCustomer $customer, InternetPlan $newPlan): PppoeCustomer
    {
        if ($newPlan->type !== 'pppoe') {
            throw ValidationException::withMessages([
                'plan_id' => 'The selected plan is not a PPPoE plan.',
            ]);
        }

        $customer->update(['plan_id' => $newPlan->id]);

        if (!in_array($customer->status, ['pending', 'terminated'])) {
            $this->rebuildRadiusRows($customer);
        }

        try {
            $this->coaService->disconnectUsername($customer->username);
        } catch (\Throwable $e) {
            // Ignore CoA failure
        }

        return $customer;
    }

    /**
     * Terminate a subscriber account.
     * RADIUS rows are deleted.
     */
    public function terminate(User $actor, PppoeCustomer $customer): PppoeCustomer
    {
        DB::transaction(function () use ($customer) {
            $customer->update(['status' => 'terminated']);
            $this->deleteRadiusRows($customer->username);
        });

        try {
            $this->coaService->disconnectUsername($customer->username);
        } catch (\Throwable $e) {
            // Ignore CoA failure
        }

        return $customer;
    }

    /**
     * Delete a subscriber permanently.
     */
    public function destroy(User $actor, PppoeCustomer $customer): void
    {
        $username = $customer->username;

        DB::transaction(function () use ($customer, $username) {
            $this->deleteRadiusRows($username);
            $customer->delete();
        });

        try {
            $this->coaService->disconnectUsername($username);
        } catch (\Throwable $e) {
            // Ignore CoA failure
        }
    }

    /**
     * Disconnect active sessions for a subscriber.
     */
    public function disconnect(User $actor, PppoeCustomer $customer): array
    {
        return $this->coaService->disconnectUsername($customer->username);
    }

    /**
     * Rebuild radcheck & radreply rows for a subscriber.
     */
    public function rebuildRadiusRows(PppoeCustomer $customer): void
    {
        $rows = $this->radiusService->rows($customer);

        DB::transaction(function () use ($customer, $rows) {
            DB::table('radcheck')->where('username', $customer->username)->delete();
            DB::table('radreply')->where('username', $customer->username)->delete();

            if (!empty($rows['check'])) {
                DB::table('radcheck')->insert($rows['check']);
            }
            if (!empty($rows['reply'])) {
                DB::table('radreply')->insert($rows['reply']);
            }
        });
    }

    /**
     * Delete radcheck & radreply rows for a username.
     */
    public function deleteRadiusRows(string $username): void
    {
        DB::table('radcheck')->where('username', $username)->delete();
        DB::table('radreply')->where('username', $username)->delete();
    }
}
