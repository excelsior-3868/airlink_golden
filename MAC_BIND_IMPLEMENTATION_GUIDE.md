# Multi-Tenant Replication Guide: Dynamic MAC Rejection & Voucher MAC Management Modal

This document details all changes required to replicate the dynamic MAC address rejection messaging and the admin "Change MAC Address" modal across other Airlink multi-tenant environments.

---

## 0. Two prerequisites before you replicate any of this

Both were found in production on `airlink_mera` and both make a perfectly good
MAC-bound card look like a wrong password to the customer *and* to whoever is
reading the RADIUS log. Replicate them first.

### A. Phones rotate their MAC — auto-bind locks onto a throwaway address

iOS "Private Wi-Fi Address" and Android "Randomized MAC" hand the hotspot a
*locally-administered* MAC (second hex digit is one of `2 6 A E`) that changes
per network and, on Android 12+, periodically re-randomizes. "Lock on first
login" therefore binds the card to an address the phone will abandon, and every
later login is a `mac_mismatch` reject.

Audit any tenant before enabling MAC bind at scale:

```sql
SELECT code, username, status, mac_address,
  CASE WHEN SUBSTR(mac_address,2,1) IN ('2','6','A','E','a','e')
       THEN 'RANDOMIZED (phone private Wi-Fi)' ELSE 'real hardware MAC' END AS mac_kind
FROM vouchers
WHERE mac_bind = 1 AND mac_address IS NOT NULL AND mac_address <> '';
```

On `airlink_mera` this returned 6 of 6 rows as RANDOMIZED. MAC binding only
behaves as intended for devices with a stable MAC (routers, CPE, desktops with
randomization off); for phone-first hotspot customers it is a lockout
generator, not an anti-sharing control.

### B. Trailing whitespace in User-Name is rejected before any of our gates run

MikroTik's hotspot login page posts exactly what the customer typed, and phone
keyboards append a space after an autocompleted or pasted code — so FreeRADIUS
receives `"WHDEZS "`. The stock `filter_username` policy rejects **any**
username containing a space, and it runs at the very top of `authorize`, before
the voucher/PPPoE lifecycle gates. The customer is told "invalid username or
password" for a valid card. This accounted for 456 rejects in one month's log.

Add the trim immediately **before** `filter_username` in the `authorize` block
(it must come first — `filter_username` rejects outright, so nothing after it
gets a chance to clean the name up):

```radius
	if (&User-Name && &User-Name =~ /^[[:space:]]*(.*[^[:space:]])[[:space:]]*$/) {
		update request {
			&User-Name := "%{1}"
		}
	}

	filter_username
```

Only the ends are trimmed. Internal spaces are left alone, so `filter_username`
still rejects the junk logins (customers typing their SSID as the username)
exactly as before.

---

## 1. FreeRADIUS Dynamic MAC Rejection Message

**File**: `docker/freeradius/sites-enabled/default`

Update the `mac_mismatch` reject handlers in the `authorize` block to inject the
registered MAC into both the customer-facing `Reply-Message` **and** the server
log.

The log half matters as much as the reply. A `reject` from `authorize` is logged
by FreeRADIUS as a bare `Invalid user` / `Login incorrect`, which is
indistinguishable from a wrong password — the `Reply-Message` never reaches the
log file. Setting `&Module-Failure-Message` is what makes FreeRADIUS write
`Invalid user (<reason>)` instead. Do the same for every other reject case in
both switch blocks (`expired`, `disabled`, `quota`, `daily_quota`,
`nas_mismatch`, `suspended`, `terminated`).

Looking the MAC up into a `control:` temp first means one SQL round trip, not
two, even though the value is now used twice.

### A. Hotspot Vouchers Reject Block
In the `Tmp-String-0` query, add the `randomized_mac` detection condition taking `enforce_physical_mac` into account:
```sql
				WHEN mac_bind = 1 AND mac_address IS NOT NULL AND mac_address <> '' \
					AND mac_address <> '%{Calling-Station-Id}' THEN 'mac_mismatch' \
				WHEN mac_bind = 1 AND (enforce_physical_mac IS NULL OR enforce_physical_mac = 1) \
					AND (mac_address IS NULL OR mac_address = '') \
					AND '%{Calling-Station-Id}' REGEXP '^[0-9a-fA-F][26aAeE]' THEN 'randomized_mac' \
```

And in the `switch &control:Tmp-String-0` block:

```radius
		case "mac_mismatch" {
			update control {
				Tmp-String-5 := "%{sql: SELECT mac_address FROM vouchers WHERE username = '%{User-Name}' LIMIT 1}"
			}
			update request {
				&Module-Failure-Message += "Rejected: voucher MAC-bound to %{control:Tmp-String-5}, device sent %{Calling-Station-Id}"
			}
			update reply {
				Reply-Message := "This voucher is already bound to another MAC address (%{control:Tmp-String-5})."
			}
			reject
		}
		case "randomized_mac" {
			update request {
				&Module-Failure-Message += "Rejected: Private/Randomized MAC (%{Calling-Station-Id}) blocked for MAC-bound voucher"
			}
			update reply {
				Reply-Message := "Private MAC Detected!\r\n• Android: Wi-Fi Settings -> Privacy -> Use Phone MAC\r\n• iPhone: Wi-Fi Settings -> Private Address OFF\r\nThen reconnect to Wi-Fi."
			}
			reject
		}
```

### B. PPPoE Customers Reject Block
In the `Tmp-String-3` query, add the `randomized_mac` condition:
```sql
				WHEN mac_bind = 1 AND mac_address IS NOT NULL AND mac_address <> '' \
					AND mac_address <> '%{Calling-Station-Id}' THEN 'mac_mismatch' \
				WHEN mac_bind = 1 AND (mac_address IS NULL OR mac_address = '') \
					AND '%{Calling-Station-Id}' REGEXP '^[0-9a-fA-F][26aAeE]' THEN 'randomized_mac' \
```

And in the `switch &control:Tmp-String-3` block:

```radius
		case "mac_mismatch" {
			update control {
				Tmp-String-6 := "%{sql: SELECT mac_address FROM pppoe_customers WHERE username = '%{User-Name}' LIMIT 1}"
			}
			update request {
				&Module-Failure-Message += "Rejected: PPPoE subscriber MAC-bound to %{control:Tmp-String-6}, device sent %{Calling-Station-Id}"
			}
			update reply {
				Reply-Message := "This account is already bound to another MAC address (%{control:Tmp-String-6})."
			}
			reject
		}
		case "randomized_mac" {
			update request {
				&Module-Failure-Message += "Rejected: Private/Randomized MAC (%{Calling-Station-Id}) blocked for MAC-bound subscriber"
			}
			update reply {
				Reply-Message := "Private MAC detected. Turn OFF 'Private MAC' in device/router settings and reconnect."
			}
			reject
		}
```

### C. Customer Instructions to Resolve Private / Randomized MAC

#### 🤖 Android (Samsung, Xiaomi, OnePlus, Pixel, Realme, etc.)
1. Open **Settings → Wi-Fi** (or **Network & Internet**).
2. Tap the connected Wi-Fi network (or tap the **⚙️ / ℹ️ / Advanced** icon).
3. Look for **Privacy** or **MAC Address Type**.
4. Change from **Randomized MAC** ➔ **Phone MAC / Device MAC**.
5. Disconnect and reconnect to Wi-Fi.

#### 🍏 iPhone / iPad (iOS)
1. Go to **Settings → Wi-Fi**.
2. Tap the **ⓘ** icon beside the connected Wi-Fi network.
3. Turn **Private Wi-Fi Address** to **OFF**.
4. Confirm if prompted.
5. Reconnect to the Wi-Fi.

#### 💻 Windows 10 / 11
1. Open **Settings → Network & Internet → Wi-Fi**.
2. Tap the Wi-Fi network name.
3. Set **Random Hardware Addresses** to **OFF**.

### C. Verifying
`freeradius -XC` only proves it parses. To prove behaviour, run a throwaway
container off the same image with the patched site mounted, on the tenant's
docker network, and drive it with `radclient`:

```
docker run --rm --network <tenant>_default \
  -v "$PWD/docker/freeradius/sites-enabled/default:/etc/freeradius/sites-enabled/default:ro" \
  -v <tenant>_radius_shared:/var/lib/airlink-radius:ro \
  --entrypoint bash <tenant>-freeradius /test.sh
```

The log should now separate the three cases cleanly:

```
Invalid user (Rejected: voucher MAC-bound to 0E:90:57:01:88:EE, device sent D6:43:AF:D0:D8:E2): [WHDEZS/WHDEZS]
Login incorrect (pap: Cleartext password does not match "known good" password): [WHDEZS/NOPE99]
Invalid user (Rejected: voucher expired or spent): [3A76CC/3A76CC]
```

Note the probe writes rows to `radpostauth` on the tenant's live database.

---
 
 ## 2. Database Migration for Physical MAC Enforcement

**File**: `backend/database/migrations/2026_09_16_000000_add_enforce_physical_mac_to_plans_and_vouchers.php`

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            if (!Schema::hasColumn('internet_plans', 'enforce_physical_mac')) {
                $table->boolean('enforce_physical_mac')->default(true)->after('mac_bind');
            }
        });

        Schema::table('vouchers', function (Blueprint $table) {
            if (!Schema::hasColumn('vouchers', 'enforce_physical_mac')) {
                $table->boolean('enforce_physical_mac')->default(true)->after('mac_bind');
            }
        });
    }

    public function down(): void
    {
        Schema::table('internet_plans', function (Blueprint $table) {
            if (Schema::hasColumn('internet_plans', 'enforce_physical_mac')) {
                $table->dropColumn('enforce_physical_mac');
            }
        });

        Schema::table('vouchers', function (Blueprint $table) {
            if (Schema::hasColumn('vouchers', 'enforce_physical_mac')) {
                $table->dropColumn('enforce_physical_mac');
            }
        });
    }
};
```

---

## 3. Backend API Routes & Controller

### A. API Routes
**File**: `backend/routes/api.php`

Add the `/update-mac` routes under the authenticated voucher routes:

```php
Route::patch('/vouchers/{voucher}/reset-mac', [VoucherController::class, 'resetMac']);
Route::patch('/vouchers/{voucher}/update-mac', [VoucherController::class, 'updateMac']);
Route::patch('/vouchers/{voucher}/mac', [VoucherController::class, 'updateMac']);
```

### B. VoucherController Implementation
**File**: `backend/app/Http/Controllers/Api/VoucherController.php`

Add the `updateMac` method:

```php
    /**
     * Set, update, or toggle MAC address binding for a voucher.
     */
    public function updateMac(Request $request, Voucher $voucher): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.enable')) {
            return $this->fail("This API token does not have the 'vouchers.enable' ability.", 403);
        }

        if (! $this->canAccess($request->user(), $voucher)) {
            return $this->fail('You do not have permission to modify this voucher.', 403);
        }

        $validated = $request->validate([
            'mac_bind' => ['nullable', 'boolean'],
            'mac_address' => [
                'nullable',
                'string',
                'regex:/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/'
            ],
        ]);

        $updates = [];
        if (array_key_exists('mac_bind', $validated)) {
            $updates['mac_bind'] = (bool) $validated['mac_bind'];
        }
        if (array_key_exists('mac_address', $validated)) {
            $mac = $validated['mac_address'] ? strtoupper(str_replace('-', ':', trim($validated['mac_address']))) : null;
            $updates['mac_address'] = $mac;
            if ($mac && !isset($updates['mac_bind'])) {
                $updates['mac_bind'] = true;
            }
        }

        if (!empty($updates)) {
            $voucher->update($updates);
        }

        return $this->ok($voucher->fresh(), 'MAC address settings updated successfully.');
    }
```

### C. VoucherService Integration
**File**: `backend/app/Services/VoucherService.php`

Pass `enforce_physical_mac` from the plan when generating vouchers:
```php
    'mac_bind' => (bool) $plan->mac_bind,
    'enforce_physical_mac' => (bool) ($plan->enforce_physical_mac ?? true),
```

---

## 4. Frontend Hotspot Plan Config & Vouchers MAC Modal

### A. Hotspot Plans Page (Access Restriction Tab)
**File**: `frontend/src/pages/HotspotPlans.tsx`

Under the Access Restriction tab in the Plan modal:
```tsx
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Bind to First-Used MAC Address</label>
                <CustomSelect
                  value={form.mac_bind ? '1' : '0'}
                  onChange={(val) => setForm({ ...form, mac_bind: val === '1' })}
                  options={[
                    { value: '0', label: 'Disabled' },
                    { value: '1', label: 'Enabled' }
                  ]}
                  className="w-full"
                />
              </div>

              {form.mac_bind && (
                <div className="col-span-2 space-y-2">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">
                    Enforce Physical MAC Address (Block Private Wi-Fi)
                  </label>
                  <CustomSelect
                    value={form.enforce_physical_mac !== false ? '1' : '0'}
                    onChange={(val) => setForm({ ...form, enforce_physical_mac: val === '1' })}
                    options={[
                      { value: '1', label: 'Enabled (Require Real Hardware / Phone MAC)' },
                      { value: '0', label: 'Disabled (Allow Randomized / Private MACs)' }
                    ]}
                    className="w-full"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-900/50 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
                    {form.enforce_physical_mac !== false ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                        🛡️ <strong>Active Protection:</strong> Phones connecting with randomized private MAC addresses will be instructed to toggle off "Private Wi-Fi Address" and use device MAC before voucher activation to prevent lockouts.
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400 font-medium">
                        ⚠️ <strong>Warning:</strong> Randomized MACs will be allowed. If a customer's phone rotates its MAC address later, they may get locked out of their voucher.
                      </span>
                    )}
                  </p>
                </div>
              )}
```

### B. Vouchers Page ("Change MAC Address" Modal & Actions)
**File**: `frontend/src/pages/Vouchers.tsx`

#### 1. Add State & Handlers
Add inside the component:

```tsx
  // Change / Edit MAC Address state
  const [changeMacVoucher, setChangeMacVoucher] = useState<any>(null)
  const [macBindEnabled, setMacBindEnabled] = useState(false)
  const [macAddressInput, setMacAddressInput] = useState('')
  const [changeMacResult, setChangeMacResult] = useState('')
  const [changeMacError, setChangeMacError] = useState('')
  const [changingMac, setChangingMac] = useState(false)

  const openChangeMac = (v: any) => {
    setChangeMacVoucher(v)
    setMacBindEnabled(Boolean(v.mac_bind))
    setMacAddressInput(v.mac_address || '')
    setChangeMacResult('')
    setChangeMacError('')
    setChangingMac(false)
  }

  const confirmChangeMac = async () => {
    if (!changeMacVoucher) return
    setChangingMac(true)
    setChangeMacError('')
    try {
      const cleanMac = macAddressInput.trim() || null
      await api.patch(`/vouchers/${changeMacVoucher.id}/update-mac`, {
        mac_bind: macBindEnabled,
        mac_address: cleanMac,
      })
      setChangeMacResult(cleanMac ? `Locked to MAC: ${cleanMac.toUpperCase()}` : (macBindEnabled ? 'MAC lock cleared. The next device to connect will bind automatically.' : 'MAC Binding disabled.'))
      load()
    } catch (e) {
      setChangeMacError(apiError(e))
    } finally {
      setChangingMac(false)
    }
  }

  const clearMacAndAutoBind = async () => {
    if (!changeMacVoucher) return
    setChangingMac(true)
    setChangeMacError('')
    try {
      await api.patch(`/vouchers/${changeMacVoucher.id}/update-mac`, {
        mac_bind: true,
        mac_address: null,
      })
      setMacAddressInput('')
      setMacBindEnabled(true)
      setChangeMacResult('MAC lock cleared. The next connecting device will be automatically registered.')
      load()
    } catch (e) {
      setChangeMacError(apiError(e))
    } finally {
      setChangingMac(false)
    }
  }
```

#### 2. Add Action Menu Entry
In the voucher table's `ActionMenu` options list:

```tsx
{
  label: 'Change MAC Address',
  className: 'text-amber-600',
  onClick: () => openChangeMac(v),
},
```

#### 3. Add Modal JSX
Place before the closing tag of the component JSX:

```tsx
      {/* Change MAC Address Modal */}
      <Modal
        open={!!changeMacVoucher}
        onClose={() => setChangeMacVoucher(null)}
        title={`Change MAC Address: ${changeMacVoucher?.username}`}
        subtitle={!changeMacResult ? 'Configure hardware device lock and MAC address binding for this voucher.' : undefined}
      >
        <div className="space-y-4">
          {changeMacResult ? (
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-2xl p-5 text-center space-y-2 border border-slate-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Setting Updated</p>
              <p className="text-base font-mono font-bold text-amber-600 dark:text-amber-400">{changeMacResult}</p>
              <p className="text-xs text-slate-400 mt-2">The updated MAC lock policy is now active in FreeRADIUS.</p>
            </div>
          ) : (
            <>
              <div className="bg-slate-50 dark:bg-slate-900/60 rounded-2xl p-4 text-sm space-y-2 border border-slate-100 dark:border-slate-800">
                <div className="flex justify-between items-center"><span className="text-muted-foreground text-xs font-semibold uppercase">Voucher Code</span><span className="font-bold font-mono text-base">{changeMacVoucher?.username}</span></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground text-xs font-semibold uppercase">Current Status</span><span className="font-bold font-mono text-xs">{changeMacVoucher?.mac_bind ? (changeMacVoucher?.mac_address ? `Locked (${changeMacVoucher.mac_address})` : 'Auto-Bind (Waiting for Login)') : 'Disabled'}</span></div>
              </div>

              <div className="p-3 bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border border-slate-100 dark:border-slate-800/80">
                <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded text-primary border-slate-300 focus:ring-primary"
                    checked={macBindEnabled}
                    onChange={(e) => {
                      setMacBindEnabled(e.target.checked)
                      if (!e.target.checked) setMacAddressInput('')
                    }}
                  />
                  <span>Enable MAC Address Binding</span>
                </label>
                <p className="text-xs text-slate-400 mt-1 ml-6.5">
                  When enabled, this voucher will only authenticate from its registered device.
                </p>
              </div>

              {macBindEnabled && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Registered MAC Address</label>
                    {changeMacVoucher?.mac_address && (
                      <button
                        type="button"
                        onClick={clearMacAndAutoBind}
                        disabled={changingMac}
                        className="text-xs text-amber-600 hover:text-amber-700 font-bold hover:underline"
                      >
                        Reset / Clear MAC Lock
                      </button>
                    )}
                  </div>
                  <input
                    className="input font-mono uppercase"
                    placeholder="e.g. F2:96:44:35:BA:EC (or leave empty to auto-bind)"
                    value={macAddressInput}
                    onChange={(e) => setMacAddressInput(e.target.value.toUpperCase())}
                  />
                  <p className="text-xs text-slate-400">
                    Enter a specific MAC address to lock it immediately, or leave blank to bind on next login.
                  </p>
                </div>
              )}
            </>
          )}

          {changeMacError && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">{changeMacError}</div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setChangeMacVoucher(null)}>
              {changeMacResult ? 'Done' : 'Cancel'}
            </button>
            {!changeMacResult && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md"
                disabled={changingMac}
                onClick={confirmChangeMac}
              >
                {changingMac ? 'Saving…' : 'Save MAC Settings'}
              </motion.button>
            )}
          </div>
        </div>
      </Modal>
```

---

## 4. Build and Deploy Commands

Run on the target tenant:

```bash
# 1. Test FreeRADIUS configuration
docker exec <tenant-freeradius-container> freeradius -CX

# 2. Build and restart production containers
docker compose -f docker-compose.prod.yml up -d --build
```
