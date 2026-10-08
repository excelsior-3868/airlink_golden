<?php


namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use App\Models\User;
use App\Services\PppoeCustomerService;
use App\Services\PppoeRechargeService;
use App\Services\Radius\OnlineSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PppoeCustomerController extends Controller
{
    public function __construct(
        private readonly PppoeCustomerService $customerService,
        private readonly PppoeRechargeService $rechargeService,
    ) {
    }

    /**
     * List subscribers with server-side pagination, filtering, and live session status.
     */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = $this->scopedQuery($actor)
            ->with(['plan:id,name,bandwidth,validity_days,selling_price,status', 'owner:id,name,username,role', 'reseller:id,name,username', 'nasDevice:id,name,nasname']);

        // Filter: Search / Query
        if ($search = trim($request->input('q') ?? $request->input('search') ?? '')) {
            $query->where(function ($q) use ($search) {
                $q->where('username', 'like', "%{$search}%")
                  ->orWhere('full_name', 'like', "%{$search}%")
                  ->orWhere('phone', 'like', "%{$search}%")
                  ->orWhere('customer_code', 'like', "%{$search}%")
                  ->orWhere('address', 'like', "%{$search}%");
            });
        }

        // Filter: Status
        if ($status = $request->input('status')) {
            if ($status !== 'all') {
                $query->where('status', $status);
            }
        }

        // Filter: stat-tile view. Clicking a tile narrows the list to exactly
        // the rows that tile counted — see applyView().
        if (($view = $request->input('view')) && $view !== 'all') {
            $this->applyView($query, $view);
        }

        // Filter: Plan
        if ($planId = $request->input('plan_id')) {
            $query->where('plan_id', $planId);
        }

        // Filter: NAS Device
        if ($nasId = $request->input('nas_device_id')) {
            $query->where('nas_device_id', $nasId);
        }

        // Filter: Owner (Admin only)
        if ($actor->isAdmin() && ($ownerId = $request->input('owner_id'))) {
            $query->where('owner_id', $ownerId);
        }

        // Sorting
        $sort = $request->input('sort', 'created_at');
        $dir = strtolower($request->input('dir', 'desc')) === 'asc' ? 'asc' : 'desc';
        if (in_array($sort, ['created_at', 'expires_at', 'username', 'full_name', 'status', 'activated_at'])) {
            $query->orderBy($sort, $dir);
        } else {
            $query->orderBy('created_at', 'desc');
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $customers = $query->paginate($perPage);

        // Fetch live sessions and lifetime data for this page of subscribers
        $usernames = $customers->pluck('username')->all();
        $liveSessions = [];
        $usageStats = [];

        if (!empty($usernames)) {
            $liveSessions = OnlineSession::scopeLive(DB::table('radacct'))
                ->select('username', 'framedipaddress', 'callingstationid', 'nasipaddress', 'acctstarttime')
                ->whereIn('username', $usernames)
                ->get()
                ->keyBy('username')
                ->all();

            $usageStats = DB::table('radacct')
                ->select('username', DB::raw('SUM(COALESCE(acctinputoctets, 0) + COALESCE(acctoutputoctets, 0)) as total_octets'), DB::raw('MAX(acctstoptime) as last_stop'))
                ->whereIn('username', $usernames)
                ->groupBy('username')
                ->get()
                ->keyBy('username')
                ->all();
        }

        $customers->getCollection()->transform(function ($c) use ($liveSessions, $usageStats) {
            $live = $liveSessions[$c->username] ?? null;
            $usage = $usageStats[$c->username] ?? null;

            $c->is_online = $live !== null;
            $c->current_ip = $live?->framedipaddress ?? $c->nas_ip;
            $c->current_mac = $live?->callingstationid ?? $c->mac_address;
            $c->session_start = $live?->acctstarttime;
            $c->total_used_bytes = $usage ? (int) $usage->total_octets : 0;
            $c->last_session_at = $live ? $live->acctstarttime : ($usage?->last_stop ?? $c->activated_at);

            return $c;
        });

        return $this->ok($customers);
    }

    /**
     * Aggregated stat counts for dashboard/header tiles.
     */
    public function summary(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $base = $this->scopedQuery($actor);

        // Every tile is counted through applyView(), the same definition index()
        // filters by, so a tile can never report a number its own list refuses
        // to reproduce.
        return $this->ok([
            'total' => (clone $base)->count(),
            'active' => $this->applyView(clone $base, 'active')->count(),
            'expiring_7d' => $this->applyView(clone $base, 'expiring_7d')->count(),
            'expired_suspended' => $this->applyView(clone $base, 'expired_suspended')->count(),
            'online' => $this->applyView(clone $base, 'online')->count(),
        ]);
    }

    /**
     * The five dashboard tiles double as list filters. Both the count shown on
     * a tile and the rows returned when it is clicked come from here, so the
     * two cannot drift apart.
     *
     * @param  \Illuminate\Database\Eloquent\Builder  $query
     * @return \Illuminate\Database\Eloquent\Builder
     */
    private function applyView($query, string $view)
    {
        return match ($view) {
            'active' => $query->where('status', 'active'),
            'expiring_7d' => $query->where('status', 'active')
                ->whereNotNull('expires_at')
                ->whereBetween('expires_at', [now(), now()->addDays(7)]),
            'expired_suspended' => $query->whereIn('status', ['expired', 'suspended']),
            'online' => $query->whereIn(
                'username',
                OnlineSession::scopeLive(DB::table('radacct'))->select('username')
            ),
            default => $query,
        };
    }

    /**
     * Show subscriber profile with history.
     */
    public function show(Request $request, PppoeCustomer $customer): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $customer->load([
            'plan',
            'owner:id,name,username,role',
            'reseller:id,name,username',
            'nasDevice:id,name,nasname',
            'recharges' => fn ($q) => $q->with(['plan:id,name', 'collectedBy:id,name,username'])->orderBy('created_at', 'desc')->limit(200),
        ]);

        // Lifetime accounting totals for the details view (all sessions, not just the live one).
        $totals = DB::table('radacct')
            ->where('username', $customer->username)
            ->selectRaw('COUNT(*) as session_count, COALESCE(SUM(acctinputoctets),0) as input_bytes, COALESCE(SUM(acctoutputoctets),0) as output_bytes, COALESCE(SUM(acctsessiontime),0) as total_time, MIN(acctstarttime) as first_seen, MAX(acctstarttime) as last_seen')
            ->first();
        $customer->usage_totals = [
            'session_count' => (int) ($totals->session_count ?? 0),
            'input_bytes' => (int) ($totals->input_bytes ?? 0),
            'output_bytes' => (int) ($totals->output_bytes ?? 0),
            'total_time' => (int) ($totals->total_time ?? 0),
            'first_seen' => $totals->first_seen ?? null,
            'last_seen' => $totals->last_seen ?? null,
        ];

        $live = OnlineSession::scopeLive(DB::table('radacct'))
            ->where('username', $customer->username)
            ->first();

        $customer->is_online = $live !== null;
        $customer->current_session = $live;

        return $this->ok($customer);
    }

    /**
     * Check if a PPPoE username is available.
     */
    public function checkUsername(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read') && ! $request->user()->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $username = trim((string) $request->input('username', ''));
        if (mb_strlen($username) < 3) {
            return $this->ok(['available' => false, 'message' => 'Username must be at least 3 characters.']);
        }

        if (!preg_match('/^[A-Za-z0-9._@-]{3,64}$/', $username)) {
            return $this->ok(['available' => false, 'message' => 'Username contains invalid characters (letters, numbers, . _ @ - allowed).']);
        }

        $existsInCustomer = PppoeCustomer::where('username', $username)->exists();
        $existsInVoucher = \App\Models\Voucher::where('code', $username)->whereNull('void_reason')->exists();

        $available = !$existsInCustomer && !$existsInVoucher;
        return $this->ok([
            'available' => $available,
            'message' => $available ? 'Username is available.' : 'This username is already taken.'
        ]);
    }

    /**
     * Return next auto-generated PPPoE credentials.
     */
    public function nextCredentials(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read') && ! $request->user()->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $credentials = $this->customerService->generateNextCredentials();
        return $this->ok($credentials);
    }

    /**
     * Create a new subscriber.
     */
    public function store(Request $request): JsonResponse
    {
        $actor = $request->user();
        if (!$actor->tokenCan('pppoe.write') && !$actor->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.write' ability.", 403);
        }

        $data = $request->validate([
            'username' => [
                'required', 'string', 'min:3', 'max:64', 'regex:/^[A-Za-z0-9._@-]{3,64}$/', 'unique:pppoe_customers,username',
                function ($attribute, $value, $fail) {
                    if (\App\Models\Voucher::where('code', $value)->whereNull('void_reason')->exists()) {
                        $fail('The username has already been taken by an active voucher code.');
                    }
                },
            ],
            'password' => ['required', 'string', 'min:1', 'max:255'],
            'plan_id' => ['required', 'integer', 'exists:internet_plans,id'],
            'full_name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'regex:/^(?:\+?977[- ]?)?9[6-8]\d{8}$/'],
            'address' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'customer_code' => ['nullable', 'string', 'max:40'],
            'bandwidth' => ['nullable', 'string', 'max:50'],
            'simultaneous_use' => ['nullable', 'integer', 'min:1', 'max:10'],
            'contract_price' => ['nullable', 'numeric', 'min:0'],
            'mac_bind' => ['nullable', 'boolean'],
            'mac_address' => ['nullable', 'string', 'regex:/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/'],
            'nas_device_id' => ['nullable', 'integer', 'exists:nas_devices,id'],
            'owner_id' => ['nullable', 'integer', 'exists:users,id'],
            // Optional one-step onboarding: create the subscriber and take the
            // first prepaid recharge together, so an operator signing up a
            // customer who is paying today does not have to do it in two moves.
            'activate_now' => ['nullable', 'boolean'],
            'periods' => ['nullable', 'integer', 'min:1', 'max:24'],
            'payment_method' => ['nullable', 'string', 'max:40'],
        ], [
            'username.unique' => 'The username has already been taken by an existing subscriber.',
            'phone.required' => 'Mobile number is required.',
            'phone.regex' => 'Please enter a valid 10-digit mobile number (e.g. 98XXXXXXXX or 97XXXXXXXX).',
        ]);

        $data = $this->normalizeMac($data);

        $activateNow = (bool) ($data['activate_now'] ?? false);
        $periods = (int) ($data['periods'] ?? 1);
        $paymentMethod = $data['payment_method'] ?? 'wallet';
        unset($data['activate_now'], $data['periods'], $data['payment_method']);

        // One transaction so a failed first recharge (most often an insufficient
        // wallet) rolls the subscriber back too, rather than leaving a stranded
        // 'pending' row behind. The subscriber is 'pending' at this point, so
        // recharge() never fires a CoA — nothing escapes the transaction.
        $customer = DB::transaction(function () use ($actor, $data, $activateNow, $periods, $paymentMethod) {
            $customer = $this->customerService->create($actor, $data);

            if ($activateNow) {
                $this->rechargeService->recharge(
                    $actor,
                    $customer,
                    $customer->plan,
                    null,
                    null,
                    $periods,
                    $paymentMethod,
                    'Initial activation',
                );
            }

            return $customer;
        });

        return $this->created($customer->fresh(['plan', 'owner', 'reseller', 'nasDevice']), 'PPPoE subscriber created successfully.');
    }

    /**
     * Update an existing subscriber.
     */
    public function update(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        if (!$actor->tokenCan('pppoe.write') && !$actor->tokenCan('*')) {
            return $this->fail("This API token does not have the 'pppoe.write' ability.", 403);
        }

        $data = $request->validate([
            'password' => ['nullable', 'string', 'min:1', 'max:255'],
            'plan_id' => ['nullable', 'integer', 'exists:internet_plans,id'],
            'full_name' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'regex:/^(?:\+?977[- ]?)?9[6-8]\d{8}$/'],
            'address' => ['nullable', 'string', 'max:255'],
            'notes' => ['nullable', 'string'],
            'customer_code' => ['nullable', 'string', 'max:40'],
            'bandwidth' => ['nullable', 'string', 'max:50'],
            'simultaneous_use' => ['nullable', 'integer', 'min:1', 'max:10'],
            'contract_price' => ['nullable', 'numeric', 'min:0'],
            'mac_bind' => ['nullable', 'boolean'],
            'mac_address' => ['nullable', 'string', 'regex:/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/'],
            'nas_device_id' => ['nullable', 'integer', 'exists:nas_devices,id'],
        ], [
            'phone.regex' => 'Please enter a valid 10-digit mobile number (e.g. 98XXXXXXXX or 97XXXXXXXX).',
        ]);

        $data = $this->normalizeMac($data);

        $updated = $this->customerService->update($actor, $customer, $data);

        return $this->ok($updated->fresh(['plan', 'owner', 'reseller', 'nasDevice']), 'PPPoE subscriber updated successfully.');
    }

    /**
     * Store MACs in one shape -- uppercase, colon-separated -- whichever way
     * the operator typed them. The RADIUS gate compares mac_address against
     * Calling-Station-Id as a plain string, so a dash-separated row would
     * never match a NAS that sends colons and would lock the subscriber out
     * of their own account. Same normalisation as VoucherController::updateMac.
     */
    private function normalizeMac(array $data): array
    {
        if (array_key_exists('mac_address', $data)) {
            $mac = $data['mac_address'];
            $data['mac_address'] = $mac
                ? strtoupper(str_replace('-', ':', trim($mac)))
                : null;
        }

        return $data;
    }

    /**
     * Suspend a subscriber.
     */
    public function suspend(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $suspended = $this->customerService->suspend($actor, $customer);

        return $this->ok($suspended, 'Subscriber suspended.');
    }

    /**
     * Resume a subscriber.
     */
    public function resume(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $resumed = $this->customerService->resume($actor, $customer);

        return $this->ok($resumed, 'Subscriber resumed.');
    }

    /**
     * Change a subscriber's plan.
     */
    public function changePlan(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $data = $request->validate([
            'plan_id' => ['required', 'integer', 'exists:internet_plans,id'],
        ]);

        $plan = InternetPlan::findOrFail($data['plan_id']);
        $changed = $this->customerService->changePlan($actor, $customer, $plan);

        return $this->ok($changed->fresh(['plan']), 'Plan changed successfully.');
    }

    /**
     * Disconnect active live sessions.
     */
    public function disconnect(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $result = $this->customerService->disconnect($actor, $customer);

        // CoaService never throws — every outcome (success, no live session,
        // unresolvable NAS, unreachable router, NAK) comes back as a per-session
        // status/reason instead. Surface that here, or a failed/skipped disconnect
        // looks identical to a successful one to the caller.
        $disconnected = collect($result)->where('status', 'disconnected')->count();
        $reasons = collect($result)->whereIn('status', ['failed', 'skipped'])->pluck('reason')->filter()->unique()->values();

        $message = match (true) {
            $disconnected > 0 && $reasons->isEmpty() => 'Disconnect command issued.',
            $disconnected > 0 => "Disconnected {$disconnected} session(s), but " . $reasons->count() . ' could not be reached: ' . $reasons->first(),
            $reasons->isNotEmpty() => $reasons->first(),
            default => 'No active session found for this subscriber.',
        };

        return $this->ok($result, $message);
    }

    /**
     * Delete subscriber permanently.
     */
    public function destroy(Request $request, PppoeCustomer $customer): JsonResponse
    {
        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $this->customerService->destroy($actor, $customer);

        return $this->ok(null, 'Subscriber deleted successfully.');
    }

    /**
     * Radius accounting history for a subscriber.
     */
    public function sessions(Request $request, PppoeCustomer $customer): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $sessions = DB::table('radacct')
            ->where('username', $customer->username)
            ->orderBy('radacctid', 'desc')
            ->paginate($perPage);

        return $this->ok($sessions);
    }

    /**
     * Day-by-day data usage for one subscriber, summed from RADIUS accounting.
     * Each session is attributed to the (Nepal-local) day it started, and every
     * day in the window is returned — zero-filled — so charts have no gaps.
     * Download is acctoutputoctets (NAS → subscriber), upload is acctinputoctets.
     */
    public function usage(Request $request, PppoeCustomer $customer): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        if (!$this->canAccess($actor, $customer)) {
            return $this->fail('You do not have access to this subscriber.', 403);
        }

        $days = max(1, min(365, (int) $request->input('days', 30)));
        $tz = 'Asia/Kathmandu';
        $today = now($tz)->startOfDay();
        $start = (clone $today)->subDays($days - 1);
        $offset = $today->format('P'); // e.g. +05:45

        $rows = DB::table('radacct')
            ->where('username', $customer->username)
            ->where('acctstarttime', '>=', (clone $start)->utc()->toDateTimeString())
            ->selectRaw(
                'DATE(CONVERT_TZ(acctstarttime, \'+00:00\', ?)) as day, COUNT(*) as sessions, '
                . 'COALESCE(SUM(acctoutputoctets),0) as download, COALESCE(SUM(acctinputoctets),0) as upload, '
                . 'COALESCE(SUM(acctsessiontime),0) as online_seconds',
                [$offset]
            )
            ->groupBy('day')
            ->get()
            ->keyBy('day');

        $daily = [];
        for ($i = 0; $i < $days; $i++) {
            $key = (clone $start)->addDays($i)->toDateString();
            $r = $rows->get($key);
            $download = (int) ($r->download ?? 0);
            $upload = (int) ($r->upload ?? 0);
            $daily[] = [
                'date' => $key,
                'sessions' => (int) ($r->sessions ?? 0),
                'download' => $download,
                'upload' => $upload,
                'total' => $download + $upload,
                'online_seconds' => (int) ($r->online_seconds ?? 0),
            ];
        }

        $download = array_sum(array_column($daily, 'download'));
        $upload = array_sum(array_column($daily, 'upload'));

        return $this->ok([
            'days' => $days,
            'daily' => $daily,
            'totals' => [
                'download' => $download,
                'upload' => $upload,
                'total' => $download + $upload,
                'sessions' => array_sum(array_column($daily, 'sessions')),
                'online_seconds' => array_sum(array_column($daily, 'online_seconds')),
                'average_per_day' => (int) round(($download + $upload) / $days),
            ],
        ]);
    }

    /**
     * Live active RADIUS sessions across all scoped PPPoE subscribers.
     */
    public function liveSessions(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = OnlineSession::scopeLive(DB::table('radacct'))
            ->join('pppoe_customers', 'pppoe_customers.username', '=', 'radacct.username')
            ->leftJoin('internet_plans', 'internet_plans.id', '=', 'pppoe_customers.plan_id')
            ->select(
                'radacct.radacctid',
                'radacct.username',
                'pppoe_customers.id as customer_id',
                'pppoe_customers.full_name',
                'pppoe_customers.phone',
                'internet_plans.name as plan_name',
                'radacct.framedipaddress as ip_address',
                'radacct.callingstationid as mac_address',
                'radacct.nasipaddress as nas_ip',
                'radacct.acctstarttime as start_time',
                'radacct.acctupdatetime as update_time',
                'radacct.acctinputoctets as input_bytes',
                'radacct.acctoutputoctets as output_bytes',
                DB::raw('CAST(GREATEST(0, TIMESTAMPDIFF(SECOND, radacct.acctstarttime, NOW())) AS UNSIGNED) as session_time')
            );

        if (!$actor->isAdmin()) {
            if ($actor->isReseller()) {
                $query->where(function ($q) use ($actor) {
                    $q->where('pppoe_customers.owner_id', $actor->id)
                      ->orWhere('pppoe_customers.reseller_id', $actor->id);
                });
            } else {
                $query->whereRaw('1 = 0');
            }
        }

        if ($search = trim($request->input('q') ?? $request->input('search') ?? '')) {
            $query->where(function ($q) use ($search) {
                $q->where('radacct.username', 'like', "%{$search}%")
                  ->orWhere('pppoe_customers.full_name', 'like', "%{$search}%")
                  ->orWhere('radacct.callingstationid', 'like', "%{$search}%")
                  ->orWhere('radacct.framedipaddress', 'like', "%{$search}%")
                  ->orWhere('radacct.nasipaddress', 'like', "%{$search}%");
            });
        }

        // Filtered here rather than in the client: the feed is paginated, so a
        // client-side NAS filter would only ever narrow the visible page.
        if ($nasIp = trim((string) $request->input('nas_ip', ''))) {
            $query->where('radacct.nasipaddress', $nasIp);
        }

        $perPage = max(1, min(100, (int) $request->input('per_page', 15)));
        $sessions = $query->orderBy('radacct.acctstarttime', 'desc')->paginate($perPage);

        return $this->ok($sessions);
    }

    /**
     * Export subscribers as CSV.
     */
    public function exportCsv(Request $request): StreamedResponse|JsonResponse
    {
        if (! $request->user()->tokenCan('pppoe.read')) {
            return $this->fail("This API token does not have the 'pppoe.read' ability.", 403);
        }

        $actor = $request->user();
        $query = $this->scopedQuery($actor)->with(['plan', 'owner', 'reseller']);

        $filename = 'pppoe_subscribers_' . date('Ymd_His') . '.csv';

        return response()->streamDownload(function () use ($query) {
            $handle = fopen('php://output', 'w');
            fputcsv($handle, [
                'ID', 'Username', 'Full Name', 'Phone', 'Address', 'Customer Code',
                'Status', 'Plan', 'Activated At', 'Expires At', 'Contract Price',
                'Bandwidth', 'NAS IP', 'MAC Address', 'Owner', 'Reseller'
            ]);

            $query->chunk(200, function ($customers) use ($handle) {
                foreach ($customers as $c) {
                    fputcsv($handle, [
                        $c->id,
                        $c->username,
                        $c->full_name,
                        $c->phone ?? '',
                        $c->address ?? '',
                        $c->customer_code ?? '',
                        $c->status,
                        $c->plan?->name ?? '',
                        $c->activated_at ? $c->activated_at->toDateTimeString() : '',
                        $c->expires_at ? $c->expires_at->toDateTimeString() : '',
                        $c->contract_price ?? '',
                        $c->bandwidth ?? '',
                        $c->nas_ip ?? '',
                        $c->mac_address ?? '',
                        $c->owner?->name ?? '',
                        $c->reseller?->name ?? '',
                    ]);
                }
            });

            fclose($handle);
        }, $filename, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * Base scoped query for subscribers based on user role.
     */
    private function scopedQuery(User $actor)
    {
        $query = PppoeCustomer::query();

        if ($actor->isAdmin()) {
            return $query;
        }

        if ($actor->isReseller()) {
            return $query->where(function ($q) use ($actor) {
                $q->where('owner_id', $actor->id)
                  ->orWhere('reseller_id', $actor->id);
            });
        }

        // Sellers are barred from PPPoE
        return $query->whereRaw('1 = 0');
    }

    /**
     * Check if actor has permission to view/modify subscriber.
     */
    private function canAccess(User $actor, PppoeCustomer $customer): bool
    {
        if ($actor->isAdmin()) {
            return true;
        }

        if ($actor->isReseller()) {
            return $customer->owner_id === $actor->id || $customer->reseller_id === $actor->id;
        }

        return false;
    }
}
