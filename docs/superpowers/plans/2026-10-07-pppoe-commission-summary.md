# PPPoE Commission Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "PPPoE Commission" page showing each reseller's admin/reseller commission split on PPPoE recharges, filterable by reseller and date range.

**Architecture:** One new read-only report endpoint aggregates `pppoe_recharges` (which already snapshots `price`, `admin_share`, `reseller_share`, `reseller_id`) grouped by reseller. A new React page consumes it, copying the filter bar from `PppoeSalesSummary.tsx`.

**Tech Stack:** Laravel (PHPUnit feature tests, `RefreshDatabase`), React + TypeScript + Tailwind, recharts, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-07-pppoe-commission-summary-design.md`

## Global Constraints

- Source table is `pppoe_recharges` only; registrations are excluded.
- Date filter: `whereDate('pr.created_at', ...)` for `from`/`to` (inclusive), same as Sales Summary.
- Permission `view_pppoe`, roles admin + reseller; sellers get 403.
- Recharges with null `reseller_id` are reported as "Direct (no reseller)".
- Responses use `$this->ok([...])` (shape `{success, data}`).

## File Structure

- Modify `backend/app/Http/Controllers/Api/ReportController.php` — add `pppoeCommissionSummary()`.
- Modify `backend/routes/api.php` — one route, next to `pppoe-sales-summary`.
- Create `backend/tests/Feature/PppoeCommissionSummaryTest.php`.
- Create `frontend/src/pages/PppoeCommissionSummary.tsx`.
- Modify `frontend/src/App.tsx` — import + route.
- Modify `frontend/src/layouts/AppShell.tsx` — sidebar child.

---

### Task 1: Commission summary endpoint

**Files:**
- Modify: `backend/app/Http/Controllers/Api/ReportController.php` (add method before the final `}`)
- Modify: `backend/routes/api.php:166`
- Test: `backend/tests/Feature/PppoeCommissionSummaryTest.php`

**Interfaces:**
- Produces: `GET /api/reports/pppoe-commission-summary?from=&to=&reseller_id=` returning
  `data.rows[]` = `{reseller_id:int|null, reseller_name:string, recharges:int, total_sales:float, commission_percent:float, admin_share:float, reseller_share:float}`,
  `data.totals` = `{recharges, total_sales, admin_share, reseller_share}`,
  `data.recharges[]` = `{id, reference, reseller_id:int|null, subscriber_name, username, plan_name, price, admin_share, reseller_share, created_at}` (newest first, max 500).
  `commission_percent` is the effective percent: `admin_share / total_sales * 100`, 0 when no sales.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/Feature/PppoeCommissionSummaryTest.php`:

```php
<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\SystemPermission;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** GET /api/reports/pppoe-commission-summary */
class PppoeCommissionSummaryTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;
    private User $resellerA;
    private User $resellerB;
    private User $seller;
    private InternetPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();

        (new \Database\Seeders\DatabaseSeeder())->run();
        SystemPermission::flushCache();

        $this->admin = $this->makeUser('admin');
        $this->resellerA = $this->makeUser('reseller', ['name' => 'Alpha']);
        $this->resellerB = $this->makeUser('reseller', ['name' => 'Beta']);
        $this->seller = $this->makeUser('seller', ['parent_id' => $this->resellerA->id]);

        $this->plan = InternetPlan::create([
            'name' => 'PPPoE 20Mbps', 'type' => 'pppoe', 'package_type' => 'wallet',
            'plan_type' => 'unlimited', 'validity_days' => 30, 'base_price' => 800,
            'selling_price' => 1000, 'created_by' => $this->admin->id,
        ]);
    }

    private function recharge(?User $reseller, float $price, float $adminShare, $createdAt = null): void
    {
        static $n = 0;
        $n++;

        $customerId = DB::table('pppoe_customers')->insertGetId([
            'username' => "csub{$n}", 'password' => 'secret', 'plan_id' => $this->plan->id,
            'owner_id' => $reseller?->id ?? $this->admin->id, 'reseller_id' => $reseller?->id,
            'full_name' => "Sub {$n}", 'status' => 'active', 'simultaneous_use' => 1,
            'mac_bind' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('pppoe_recharges')->insert([
            'reference' => "CRG-{$n}", 'customer_id' => $customerId, 'plan_id' => $this->plan->id,
            'owner_id' => $reseller?->id ?? $this->admin->id, 'reseller_id' => $reseller?->id,
            'collected_by' => $this->admin->id, 'price' => $price, 'base_price' => $price,
            'commission_percent' => $price > 0 ? round($adminShare / $price * 100, 2) : 0,
            'admin_share' => $adminShare, 'reseller_share' => $price - $adminShare,
            'validity_days' => 30, 'period_start' => now(), 'period_end' => now()->addDays(30),
            'created_at' => $createdAt ?? now(), 'updated_at' => $createdAt ?? now(),
        ]);
    }

    public function test_admin_sees_one_row_per_reseller_with_split_sums(): void
    {
        $this->recharge($this->resellerA, 1000, 100);
        $this->recharge($this->resellerA, 500, 50);
        $this->recharge($this->resellerB, 2000, 400);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/reports/pppoe-commission-summary');

        $res->assertOk();
        $rows = collect($res->json('data.rows'))->keyBy('reseller_name');
        $this->assertSame(2, $rows['Alpha']['recharges']);
        $this->assertEquals(1500, $rows['Alpha']['total_sales']);
        $this->assertEquals(150, $rows['Alpha']['admin_share']);
        $this->assertEquals(1350, $rows['Alpha']['reseller_share']);
        $this->assertEquals(10, $rows['Alpha']['commission_percent']);
        $this->assertEquals(20, $rows['Beta']['commission_percent']);
        $res->assertJsonPath('data.totals.recharges', 3);
        $this->assertEquals(3500, $res->json('data.totals.total_sales'));
        $this->assertEquals(550, $res->json('data.totals.admin_share'));
        $this->assertEquals(2950, $res->json('data.totals.reseller_share'));
    }

    public function test_reseller_filter_narrows_rows_and_detail(): void
    {
        $this->recharge($this->resellerA, 1000, 100);
        $this->recharge($this->resellerB, 2000, 400);

        $res = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/reports/pppoe-commission-summary?reseller_id=' . $this->resellerB->id);

        $res->assertOk();
        $this->assertCount(1, $res->json('data.rows'));
        $res->assertJsonPath('data.rows.0.reseller_id', $this->resellerB->id);
        $this->assertCount(1, $res->json('data.recharges'));
        $this->assertEquals(2000, $res->json('data.totals.total_sales'));
    }

    public function test_date_range_is_inclusive(): void
    {
        $this->recharge($this->resellerA, 1000, 100, now()->subDays(10));
        $this->recharge($this->resellerA, 300, 30, now());

        $today = now()->toDateString();
        $res = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/reports/pppoe-commission-summary?from={$today}&to={$today}");

        $res->assertOk();
        $this->assertEquals(300, $res->json('data.totals.total_sales'));
        $res->assertJsonPath('data.totals.recharges', 1);
    }

    public function test_reseller_only_sees_own_row_and_cannot_widen_scope(): void
    {
        $this->recharge($this->resellerA, 1000, 100);
        $this->recharge($this->resellerB, 2000, 400);

        $res = $this->actingAs($this->resellerA, 'sanctum')
            ->getJson('/api/reports/pppoe-commission-summary?reseller_id=' . $this->resellerB->id);

        $res->assertOk();
        $this->assertCount(1, $res->json('data.rows'));
        $res->assertJsonPath('data.rows.0.reseller_id', $this->resellerA->id);
        $this->assertEquals(1000, $res->json('data.totals.total_sales'));
    }

    public function test_recharges_without_a_reseller_go_in_the_direct_bucket(): void
    {
        $this->recharge(null, 700, 0);

        $res = $this->actingAs($this->admin, 'sanctum')->getJson('/api/reports/pppoe-commission-summary');

        $res->assertOk();
        $res->assertJsonPath('data.rows.0.reseller_id', null);
        $res->assertJsonPath('data.rows.0.reseller_name', 'Direct (no reseller)');
        $this->assertEquals(700, $res->json('data.rows.0.reseller_share'));
    }

    public function test_a_seller_is_refused(): void
    {
        $this->actingAs($this->seller, 'sanctum')
            ->getJson('/api/reports/pppoe-commission-summary')
            ->assertStatus(403);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && php artisan test --filter=PppoeCommissionSummaryTest`
Expected: FAIL (404 on the route; `assertOk` failures).

- [ ] **Step 3: Add the route**

In `backend/routes/api.php`, directly after the `/reports/pppoe-sales-summary` line (166):

```php
        Route::get   ('/reports/pppoe-commission-summary',       [ReportController::class, 'pppoeCommissionSummary'])->middleware('permission:view_pppoe');
```

- [ ] **Step 4: Add the controller method**

In `ReportController.php`, add before the final closing `}`:

```php
    /**
     * Commission split per reseller from the share snapshot stored on each
     * PPPoE recharge. admin_share is what the reseller owes the admin;
     * reseller_share is what the reseller keeps.
     */
    public function pppoeCommissionSummary(Request $request): JsonResponse
    {
        $actor = $request->user();
        $from = $request->query('from');
        $to = $request->query('to');
        $resellerId = $request->query('reseller_id');

        $base = function () use ($actor, $from, $to, $resellerId) {
            $q = DB::table('pppoe_recharges as pr');

            if ($actor->isReseller()) {
                $q->where('pr.reseller_id', $actor->id);
            } elseif ($resellerId) {
                $q->where('pr.reseller_id', $resellerId);
            }
            if ($from) {
                $q->whereDate('pr.created_at', '>=', $from);
            }
            if ($to) {
                $q->whereDate('pr.created_at', '<=', $to);
            }

            return $q;
        };

        $rows = $base()
            ->leftJoin('users as u', 'u.id', '=', 'pr.reseller_id')
            ->select(
                'pr.reseller_id',
                DB::raw("COALESCE(NULLIF(u.name, ''), u.username) as reseller_name"),
                DB::raw('count(*) as recharges'),
                DB::raw('COALESCE(sum(pr.price), 0) as total_sales'),
                DB::raw('COALESCE(sum(pr.admin_share), 0) as admin_share'),
                DB::raw('COALESCE(sum(pr.reseller_share), 0) as reseller_share')
            )
            ->groupBy('pr.reseller_id', 'u.name', 'u.username')
            ->orderByDesc('total_sales')
            ->get()
            ->map(function ($r) {
                $sales = (float) $r->total_sales;
                $admin = (float) $r->admin_share;

                return [
                    'reseller_id' => $r->reseller_id !== null ? (int) $r->reseller_id : null,
                    'reseller_name' => $r->reseller_name ?: 'Direct (no reseller)',
                    'recharges' => (int) $r->recharges,
                    'total_sales' => round($sales, 2),
                    'commission_percent' => $sales > 0 ? round($admin / $sales * 100, 2) : 0.0,
                    'admin_share' => round($admin, 2),
                    'reseller_share' => round((float) $r->reseller_share, 2),
                ];
            })
            ->values();

        $recharges = $base()
            ->join('pppoe_customers as pc', 'pc.id', '=', 'pr.customer_id')
            ->join('internet_plans as p', 'p.id', '=', 'pr.plan_id')
            ->select(
                'pr.id', 'pr.reference', 'pr.reseller_id', 'pc.full_name', 'pc.username',
                'p.name as plan_name', 'pr.price', 'pr.admin_share', 'pr.reseller_share', 'pr.created_at'
            )
            ->orderByDesc('pr.created_at')
            ->limit(500)
            ->get()
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'reference' => $r->reference,
                'reseller_id' => $r->reseller_id !== null ? (int) $r->reseller_id : null,
                'subscriber_name' => $r->full_name ?: $r->username,
                'username' => $r->username,
                'plan_name' => $r->plan_name,
                'price' => round((float) $r->price, 2),
                'admin_share' => round((float) $r->admin_share, 2),
                'reseller_share' => round((float) $r->reseller_share, 2),
                'created_at' => $r->created_at,
            ])
            ->values();

        return $this->ok([
            'rows' => $rows,
            'totals' => [
                'recharges' => (int) $rows->sum('recharges'),
                'total_sales' => round((float) $rows->sum('total_sales'), 2),
                'admin_share' => round((float) $rows->sum('admin_share'), 2),
                'reseller_share' => round((float) $rows->sum('reseller_share'), 2),
            ],
            'recharges' => $recharges,
        ]);
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && php artisan test --filter=PppoeCommissionSummaryTest`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/Http/Controllers/Api/ReportController.php backend/routes/api.php backend/tests/Feature/PppoeCommissionSummaryTest.php
git commit -m "feat(pppoe): add commission summary report endpoint"
```

---

### Task 2: Commission summary page

**Files:**
- Create: `frontend/src/pages/PppoeCommissionSummary.tsx`
- Modify: `frontend/src/App.tsx` (import near line 33; route after line 103)
- Modify: `frontend/src/layouts/AppShell.tsx` (after line 60; add `Percent` to the lucide-react import)

**Interfaces:**
- Consumes: `GET /reports/pppoe-commission-summary` from Task 1 (shape above); `Combobox`, `SelectOption`, `DualDatePicker`, `PageTitle`, `Spinner` from `../components/ui`; `rs`, `num` from `../lib/format`; `useAuth` from `../lib/auth`; `api` from `../lib/api`.

- [ ] **Step 1: Create the page**

Create `frontend/src/pages/PppoeCommissionSummary.tsx`:

```tsx
import { Fragment, useEffect, useState } from 'react'
import { Percent, Wallet, Landmark, FilterX, ChevronRight, ChevronDown } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rs, num } from '../lib/format'
import { Spinner, Combobox, SelectOption, DualDatePicker, PageTitle } from '../components/ui'

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
]

const formatDate = (d: Date) => d.toISOString().split('T')[0]

const getPresetDates = (preset: string) => {
  const now = new Date()
  if (preset === 'today') {
    const t = formatDate(now)
    return { from: t, to: t }
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const s = formatDate(y)
    return { from: s, to: s }
  }
  if (preset === 'this_week') {
    const first = new Date(now)
    const day = first.getDay() || 7
    first.setDate(first.getDate() - day + 1)
    return { from: formatDate(first), to: formatDate(now) }
  }
  if (preset === 'this_month') {
    return { from: formatDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: formatDate(now) }
  }
  return { from: '', to: '' }
}

const DEFAULT_PRESET = 'this_month'
const DEFAULT_RANGE = getPresetDates(DEFAULT_PRESET)

interface CommissionRow {
  reseller_id: number | null
  reseller_name: string
  recharges: number
  total_sales: number
  commission_percent: number
  admin_share: number
  reseller_share: number
}

interface RechargeItem {
  id: number
  reference: string
  reseller_id: number | null
  subscriber_name: string
  username: string
  plan_name: string
  price: number
  admin_share: number
  reseller_share: number
  created_at: string
}

interface CommissionData {
  rows: CommissionRow[]
  totals: { recharges: number; total_sales: number; admin_share: number; reseller_share: number }
  recharges: RechargeItem[]
}

const rowKey = (id: number | null) => (id === null ? 'direct' : String(id))

export default function PppoeCommissionSummary() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activePreset, setActivePreset] = useState<string>(DEFAULT_PRESET)
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE)
  const [resellerId, setResellerId] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [resellerOptions, setResellerOptions] = useState<SelectOption[]>([{ value: '', label: 'All Resellers' }])
  const [data, setData] = useState<CommissionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users', { params: { role: 'reseller', per_page: 200 } })
      .then((res: any) => {
        const list = Array.isArray(res.data?.data?.data)
          ? res.data.data.data
          : Array.isArray(res.data?.data) ? res.data.data : []
        setResellerOptions([
          { value: '', label: 'All Resellers' },
          ...list.map((u: any) => ({ value: String(u.id), label: u.name, keywords: u.username })),
        ])
      })
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    setLoading(true)
    const params: any = {}
    if (dateRange.from) params.from = dateRange.from
    if (dateRange.to) params.to = dateRange.to
    if (resellerId) params.reseller_id = resellerId

    api.get('/reports/pppoe-commission-summary', { params })
      .then((res: any) => {
        if (res.data?.success) setData(res.data.data)
      })
      .finally(() => setLoading(false))
  }, [dateRange, resellerId])

  const applyPreset = (key: string) => {
    setActivePreset(key)
    setDateRange(getPresetDates(key))
  }

  const isFiltered =
    activePreset !== DEFAULT_PRESET ||
    dateRange.from !== DEFAULT_RANGE.from ||
    dateRange.to !== DEFAULT_RANGE.to ||
    resellerId !== ''

  const clearFilters = () => {
    setActivePreset(DEFAULT_PRESET)
    setDateRange(getPresetDates(DEFAULT_PRESET))
    setResellerId('')
  }

  const rows = data?.rows || []
  const totals = data?.totals
  const recharges = data?.recharges || []
  const chartData = rows.map((r) => ({
    name: r.reseller_name,
    'Admin Share': r.admin_share,
    'Reseller Share': r.reseller_share,
  }))

  return (
    <div className="space-y-5">
      <PageTitle
        title="PPPoE Commission Summary"
        subtitle="Commission split between admin and each reseller on PPPoE recharges"
        icon={<Percent size={22} className="text-emerald-500" />}
      />

      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-100/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-full">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => applyPreset(item.key)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                  activePreset === item.key ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!isFiltered}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <FilterX size={14} /> Clear Filter
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {isAdmin && (
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">Reseller</label>
              <Combobox value={resellerId} onChange={setResellerId} options={resellerOptions} placeholder="All Resellers" className="w-full" />
            </div>
          )}
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">From Date</label>
            <DualDatePicker
              label="From Date"
              value={dateRange.from}
              onChange={(val) => { setActivePreset('custom'); setDateRange((p) => ({ ...p, from: val })) }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">To Date</label>
            <DualDatePicker
              label="To Date"
              value={dateRange.to}
              onChange={(val) => { setActivePreset('custom'); setDateRange((p) => ({ ...p, to: val })) }}
            />
          </div>
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Total Recharge Sales</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(totals?.total_sales || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Recharges: {num(totals?.recharges || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Wallet size={18} /></div>
            </div>
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Admin Share</p>
                <p className="text-xl font-extrabold text-indigo-600 mt-1">{rs(totals?.admin_share || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Commission owed to admin</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Landmark size={18} /></div>
            </div>
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Reseller Share</p>
                <p className="text-xl font-extrabold text-purple-600 mt-1">{rs(totals?.reseller_share || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Kept by resellers</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0"><Percent size={18} /></div>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
              <h3 className="text-sm font-bold text-slate-800 mb-4">Commission Split by Reseller</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => rs(Number(v))} />
                    <Legend />
                    <Bar dataKey="Admin Share" stackId="a" fill="#6366f1" />
                    <Bar dataKey="Reseller Share" stackId="a" fill="#a855f7" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-bold">Reseller</th>
                  <th className="px-4 py-3 font-bold text-right">Recharges</th>
                  <th className="px-4 py-3 font-bold text-right">Total Sales</th>
                  <th className="px-4 py-3 font-bold text-right">Commission %</th>
                  <th className="px-4 py-3 font-bold text-right">Admin Share</th>
                  <th className="px-4 py-3 font-bold text-right">Reseller Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No PPPoE recharges in this period.</td></tr>
                )}
                {rows.map((r) => {
                  const key = rowKey(r.reseller_id)
                  const open = expanded === key
                  const detail = recharges.filter((x) => rowKey(x.reseller_id) === key)
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => setExpanded(open ? null : key)}
                        className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer"
                      >
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          <span className="inline-flex items-center gap-1.5">
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {r.reseller_name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{num(r.recharges)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{rs(r.total_sales)}</td>
                        <td className="px-4 py-3 text-right">{r.commission_percent}%</td>
                        <td className="px-4 py-3 text-right text-indigo-600 font-semibold">{rs(r.admin_share)}</td>
                        <td className="px-4 py-3 text-right text-purple-600 font-semibold">{rs(r.reseller_share)}</td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={6} className="px-4 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-400">
                                  <th className="py-1.5 font-semibold">Reference</th>
                                  <th className="py-1.5 font-semibold">Subscriber</th>
                                  <th className="py-1.5 font-semibold">Plan</th>
                                  <th className="py-1.5 font-semibold">Date</th>
                                  <th className="py-1.5 font-semibold text-right">Price</th>
                                  <th className="py-1.5 font-semibold text-right">Admin</th>
                                  <th className="py-1.5 font-semibold text-right">Reseller</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((x) => (
                                  <tr key={x.id} className="border-t border-slate-100">
                                    <td className="py-1.5 font-mono">{x.reference}</td>
                                    <td className="py-1.5">{x.subscriber_name}</td>
                                    <td className="py-1.5">{x.plan_name}</td>
                                    <td className="py-1.5">{x.created_at?.slice(0, 10)}</td>
                                    <td className="py-1.5 text-right">{rs(x.price)}</td>
                                    <td className="py-1.5 text-right">{rs(x.admin_share)}</td>
                                    <td className="py-1.5 text-right">{rs(x.reseller_share)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              {rows.length > 0 && totals && (
                <tfoot>
                  <tr className="bg-slate-50 font-extrabold text-slate-800">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{num(totals.recharges)}</td>
                    <td className="px-4 py-3 text-right">{rs(totals.total_sales)}</td>
                    <td className="px-4 py-3 text-right">
                      {totals.total_sales > 0 ? Math.round((totals.admin_share / totals.total_sales) * 10000) / 100 : 0}%
                    </td>
                    <td className="px-4 py-3 text-right text-indigo-600">{rs(totals.admin_share)}</td>
                    <td className="px-4 py-3 text-right text-purple-600">{rs(totals.reseller_share)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register route and sidebar item**

In `frontend/src/App.tsx`, after the `PppoeSalesSummary` import (line 33):

```tsx
import PppoeCommissionSummary from './pages/PppoeCommissionSummary'
```

After the `/pppoe/sales-summary` route (line 103):

```tsx
        <Route path="/pppoe/commission-summary" element={<Guard perm="view_pppoe" roles={['admin', 'reseller']}><PppoeCommissionSummary /></Guard>} />
```

In `frontend/src/layouts/AppShell.tsx`, add `Percent` to the existing `lucide-react` import, and after the PPPoE Sales Summary child (line 60):

```tsx
      { to: '/pppoe/commission-summary', label: 'PPPoE Commission', roles: ['admin', 'reseller'], icon: Percent, color: 'text-amber-500', perm: 'view_pppoe' },
```

- [ ] **Step 3: Type-check and build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors. (If `Combobox` `onChange` rejects `setResellerId`, wrap it: `(val) => setResellerId(val)`.)

- [ ] **Step 4: Manual verification**

Rebuild the golden web container, open `/pppoe/commission-summary` as admin and as a reseller. Check: the reseller dropdown is hidden for resellers; changing the preset and the reseller filter changes the totals; clicking a row expands its recharges; "Clear Filter" resets to This Month.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PppoeCommissionSummary.tsx frontend/src/App.tsx frontend/src/layouts/AppShell.tsx
git commit -m "feat(pppoe): add PPPoE commission summary page"
```
