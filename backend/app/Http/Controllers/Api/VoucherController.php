<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InternetPlan;
use App\Models\User;
use App\Models\Voucher;
use App\Services\RadiusService;
use App\Services\VoucherCardService;
use App\Services\VoucherService;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

class VoucherController extends Controller
{
    public function __construct(
        private VoucherService $vouchers,
        private RadiusService $radius,
        private VoucherCardService $cards,
        private WalletService $wallet,
        private \App\Services\GbService $gb,
    ) {}

    public function generate(Request $request): JsonResponse
    {
        // 'vouchers.generate' is deliberately NOT in IntegrationTokenAbilities::ALL — a scoped
        // integration token (e.g. Trekkers Inn's) can never spend wallet/GB balance generating
        // stock, no matter what the underlying user's role permits. Only the SPA's own login
        // token (abilities ['*']) can reach this.
        if (! $request->user()->tokenCan('vouchers.generate')) {
            return $this->fail("This API token does not have the 'vouchers.generate' ability.", 403);
        }

        $data = $request->validate([
            'plan_id' => ['required', 'integer', 'exists:internet_plans,id'],
            'quantity' => ['required', 'integer', 'min:1', 'max:'.VoucherService::MAX_BATCH],
            'validity_days' => ['nullable', 'integer', 'min:0'],
            'note' => ['nullable', 'string', 'max:255'],
            'custom_price' => ['nullable', 'numeric', 'min:0.00'],
            'custom_base_price' => ['nullable', 'numeric', 'min:0.00'],
            'owner_id' => ['nullable', 'integer', 'exists:users,id'],
            'purchase_source' => ['nullable', 'in:gb,wallet'],
            'batch_code' => ['nullable', 'string', 'max:50'],
        ]);

        $plan = InternetPlan::findOrFail($data['plan_id']);
        $batch = $this->vouchers->generate(
            $request->user(), $plan, (int) $data['quantity'],
            $data['validity_days'] ?? null, $data['note'] ?? null,
            isset($data['custom_price']) ? (float) $data['custom_price'] : null,
            isset($data['custom_base_price']) ? (float) $data['custom_base_price'] : null,
            $data['owner_id'] ?? null,
            $data['purchase_source'] ?? 'gb',
            $data['batch_code'] ?? null,
        );

        return $this->created([
            'batch_code' => $batch->batch_code,
            'quantity' => $batch->quantity,
            'plan' => $plan->name,
            'sample' => Voucher::where('batch_id', $batch->id)->limit(5)->pluck('code'),
        ], "Generated {$batch->quantity} voucher(s).");
    }

    /** Filtered, scoped voucher list. */
    public function index(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.read')) {
            return $this->fail("This API token does not have the 'vouchers.read' ability.", 403);
        }

        $q = $this->scopedQuery($request->user())->with(['plan:id,name,package_type', 'batch:id,batch_code', 'reseller:id,username', 'seller:id,username']);

        // Actual data consumed so far, straight from radacct — separate from
        // data_gb, which is just the plan's allotted quota at generation time.
        $q->addSelect('vouchers.*')->selectSub(function ($sub) {
            $sub->from('radacct')
                ->selectRaw('ROUND(COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) / 1073741824, 3)')
                ->whereColumn('radacct.username', 'vouchers.username');
        }, 'used_gb');

        if ($s = $request->query('status')) {
            $q->where('status', $s);
        }
        if ($p = $request->query('plan_id')) {
            $q->where('plan_id', $p);
        }
        if ($b = $request->query('batch')) {
            $q->whereHas('batch', fn ($x) => $x->where('batch_code', $b));
        }
        if ($c = $request->query('code')) {
            $q->where('code', 'like', "%$c%");
        }
        if ($u = $request->query('username')) {
            $q->where('username', 'like', "%$u%");
        }
        if ($cu = $request->query('customer_username')) {
            $q->where('customer_username', 'like', "%$cu%");
        }
        if ($from = $request->query('from')) {
            $q->whereDate('created_at', '>=', $from);
        }
        if ($to = $request->query('to')) {
            $q->whereDate('created_at', '<=', $to);
        }
        if ($seasonId = $request->query('season_id')) {
            $season = \App\Models\Season::find($seasonId);
            if ($season) {
                $sm = $season->start_month;
                $sd = $season->start_day;
                $em = $season->end_month;
                $ed = $season->end_day;

                $q->where(function ($query) use ($sm, $sd, $em, $ed) {
                    if ($sm < $em || ($sm === $em && $sd <= $ed)) {
                        $query->whereRaw("
                            (MONTH(created_at) > ? OR (MONTH(created_at) = ? AND DAY(created_at) >= ?))
                            AND
                            (MONTH(created_at) < ? OR (MONTH(created_at) = ? AND DAY(created_at) <= ?))
                        ", [$sm, $sm, $sd, $em, $em, $ed]);
                    } else {
                        $query->whereRaw("
                            (MONTH(created_at) > ? OR (MONTH(created_at) = ? AND DAY(created_at) >= ?))
                            OR
                            (MONTH(created_at) < ? OR (MONTH(created_at) = ? AND DAY(created_at) <= ?))
                        ", [$sm, $sm, $sd, $em, $em, $ed]);
                    }
                });
            }
        }
        // Report drill-down by downline (admin can filter any; reseller by its sellers).
        if (($rid = $request->query('reseller_id')) && $request->user()->isAdmin()) {
            $q->where('reseller_id', $rid);
        }
        if ($sid = $request->query('seller_id')) {
            $q->where('seller_id', $sid);
        }

        return $this->ok($q->latest()->paginate($request->integer('per_page', 25)));
    }

    public function show(Request $request, Voucher $voucher): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.read')) {
            return $this->fail("This API token does not have the 'vouchers.read' ability.", 403);
        }

        if (! $this->canAccess($request->user(), $voucher)) {
            return $this->fail('Not found.', 404);
        }

        return $this->ok($voucher->load('plan', 'owner:id,username', 'reseller:id,username', 'seller:id,username'));
    }

    /** Disable a voucher — removes its RADIUS credential so it rejects. */
    public function disable(Request $request, Voucher $voucher): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.disable')) {
            return $this->fail("This API token does not have the 'vouchers.disable' ability.", 403);
        }

        if (! $this->canAccess($request->user(), $voucher)) {
            return $this->fail('You do not have permission to disable this voucher.', 403);
        }

        DB::transaction(function () use ($voucher) {
            $voucher->update(['status' => 'disabled']);
            DB::table('radcheck')->where('username', $voucher->username)->delete();
            DB::table('radreply')->where('username', $voucher->username)->delete();
        });

        return $this->ok($voucher, 'Voucher disabled.');
    }

    /** Re-enable a disabled voucher — rebuilds RADIUS rows. */
    public function enable(Request $request, Voucher $voucher): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.enable')) {
            return $this->fail("This API token does not have the 'vouchers.enable' ability.", 403);
        }

        if (! $this->canAccess($request->user(), $voucher)) {
            return $this->fail('You do not have permission to enable this voucher.', 403);
        }

        DB::transaction(function () use ($voucher) {
            $rows = $this->radius->rows($voucher->username, $voucher->password, $voucher->plan);
            DB::table('radcheck')->where('username', $voucher->username)->delete();
            DB::table('radreply')->where('username', $voucher->username)->delete();
            DB::table('radcheck')->insert($rows['check']);
            DB::table('radreply')->insert($rows['reply']);
            $voucher->update(['status' => 'active']);
        });

        return $this->ok($voucher, 'Voucher re-enabled.');
    }

    /** Delete a voucher (admin) — also drops its RADIUS rows. */
    public function destroy(Request $request, Voucher $voucher): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.delete')) {
            return $this->fail("This API token does not have the 'vouchers.delete' ability.", 403);
        }

        DB::transaction(function () use ($voucher) {
            DB::table('radcheck')->where('username', $voucher->username)->delete();
            DB::table('radreply')->where('username', $voucher->username)->delete();
            $voucher->delete();
        });

        return $this->ok(null, 'Voucher deleted.');
    }

    /** Stream a CSV of the scoped/filtered voucher list (codes + details). */
    public function exportCsv(Request $request): StreamedResponse
    {
        abort_unless($request->user()->tokenCan('vouchers.export'), 403, "This API token does not have the 'vouchers.export' ability.");

        $q = $this->scopedQuery($request->user())->with('plan:id,name');
        if ($b = $request->query('batch')) {
            $q->whereHas('batch', fn ($x) => $x->where('batch_code', $b));
        }
        if ($s = $request->query('status')) {
            $q->where('status', $s);
        }

        $filename = 'vouchers-'.now()->format('Ymd-His').'.csv';

        return response()->streamDownload(function () use ($q) {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['Code', 'Username', 'Password', 'Plan', 'Data GB', 'Validity Days', 'Price', 'Customer Name', 'Status', 'Expires At']);
            $q->chunk(2000, function ($chunk) use ($out) {
                foreach ($chunk as $v) {
                    fputcsv($out, [$v->code, $v->username, $v->password, $v->plan?->name, $v->data_gb, $v->validity_days, $v->price, $v->customer_username, $v->status, $v->expires_at]);
                }
            });
            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv']);
    }

    /** Excel (.xlsx) export of the scoped/filtered voucher list. */
    public function exportXlsx(Request $request): StreamedResponse
    {
        abort_unless($request->user()->tokenCan('vouchers.export'), 403, "This API token does not have the 'vouchers.export' ability.");

        $q = $this->scopedQuery($request->user())->with('plan:id,name');
        if ($b = $request->query('batch')) {
            $q->whereHas('batch', fn ($x) => $x->where('batch_code', $b));
        }
        if ($s = $request->query('status')) {
            $q->where('status', $s);
        }
        if ($p = $request->query('plan_id')) {
            $q->where('plan_id', $p);
        }

        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle('Vouchers');
        $sheet->fromArray(['Code', 'Username', 'Password', 'Plan', 'Data GB', 'Validity Days', 'Price', 'Customer Name', 'Status', 'Expires At'], null, 'A1');
        $sheet->getStyle('A1:J1')->getFont()->setBold(true);

        $row = 2;
        $q->chunk(2000, function ($chunk) use ($sheet, &$row) {
            foreach ($chunk as $v) {
                $sheet->fromArray([
                    $v->code, $v->username, $v->password, $v->plan?->name,
                    (float) $v->data_gb, $v->validity_days, (float) $v->price,
                    $v->customer_username,
                    $v->status, (string) $v->expires_at,
                ], null, 'A'.$row++);
            }
        });

        $filename = 'vouchers-'.now()->format('Ymd-His').'.xlsx';

        return response()->streamDownload(function () use ($spreadsheet) {
            (new Xlsx($spreadsheet))->save('php://output');
        }, $filename, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ]);
    }

    /** Single voucher card as a PNG (QR + code + plan + T&C). */
    public function card(Request $request, Voucher $voucher)
    {
        if (! $request->user()->tokenCan('vouchers.read')) {
            return $this->fail("This API token does not have the 'vouchers.read' ability.", 403);
        }
        if (! $this->canAccess($request->user(), $voucher)) {
            return $this->fail('Not found.', 404);
        }
        $voucher->load('plan');

        return response($this->cards->png($voucher), 200, [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline; filename="voucher-'.$voucher->code.'.png"',
        ]);
    }

    /** Printable HTML sheet of all cards in a batch (browser Ctrl+P). */
    public function printSheet(Request $request)
    {
        abort_unless($request->user()->tokenCan('vouchers.export'), 403, "This API token does not have the 'vouchers.export' ability.");

        $batch = $request->query('batch');
        if (! $batch) {
            return $this->fail('batch is required.', 422);
        }
        $q = $this->scopedQuery($request->user())->whereHas('batch', fn ($x) => $x->where('batch_code', $batch))->with('plan');
        $vouchers = $q->limit(2000)->get();

        $cards = $vouchers->map(function ($v) {
            $img = base64_encode($this->cards->png($v));

            return '<img src="data:image/png;base64,'.$img.'" style="width:270px;height:auto;margin:6px;border:1px solid #eee;border-radius:8px" />';
        })->implode('');

        $html = '<!doctype html><html><head><meta charset="utf-8"><title>Vouchers '.e($batch).'</title>'
            .'<style>'
            .'body{font-family:sans-serif;margin:12px;background:#f8fafc;}'
            .'h1{font-size:16px;margin:0;}'
            .'.header-bar{display:flex;align-items:center;gap:20px;background:white;padding:12px 20px;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);margin-bottom:20px;}'
            .'.btn{background:#005FA3;color:white;border:none;padding:8px 16px;font-weight:bold;border-radius:6px;cursor:pointer;}'
            .'.btn:hover{background:#004C83;}'
            .'.toggle-container{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#334155;cursor:pointer;}'
            .'.grid{display:flex;flex-wrap:wrap;}'
            .'.grayscale-mode{filter:grayscale(100%) !important;-webkit-filter:grayscale(100%) !important;}'
            .'@media print{.noprint{display:none !important;}body{background:white;margin:0;}}'
            .'</style></head><body>'
            .'<div class="header-bar noprint">'
            .'<h1>Batch '.e($batch).' — '.$vouchers->count().' vouchers</h1>'
            .'<button class="btn" onclick="window.print()">Print</button>'
            .'<label class="toggle-container">'
            .'<input type="checkbox" id="bw-toggle" onchange="document.getElementById(\'card-grid\').classList.toggle(\'grayscale-mode\', this.checked)">'
            .' Black & White Mode'
            .'</label>'
            .'</div>'
            .'<div class="grid" id="card-grid">'.$cards.'</div></body></html>';

        return response($html, 200, ['Content-Type' => 'text/html']);
    }

    /** Sell a voucher (reseller/seller). Sets status to sold, optionally registers customer_username. */
    public function sell(Request $request, Voucher $voucher): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.sell')) {
            return $this->fail("This API token does not have the 'vouchers.sell' ability.", 403);
        }

        if (! $this->canAccess($request->user(), $voucher)) {
            return $this->fail('Not found.', 404);
        }

        if ($voucher->status !== 'active') {
            return $this->fail('Only active vouchers can be marked as sold.', 422);
        }

        $data = $request->validate([
            'customer_username' => ['nullable', 'string', 'max:255'],
        ]);

        $voucher->loadMissing('plan:id,package_type');
        $isGbPackage = $voucher->plan?->package_type === 'gb';

        DB::transaction(function () use ($voucher, $data, $isGbPackage) {
            if ($isGbPackage) {
                // GB Package accounting is not commission-based: no admin_share/
                // reseller_share split. The owner's GB allocation is only spent
                // now (deferred from generation), and the full price becomes a
                // direct due up the hierarchy (Seller→Reseller, Reseller→Admin).
                $voucher->update([
                    'status' => 'sold',
                    'sold_at' => now(),
                    'customer_username' => $data['customer_username'] ?? $voucher->customer_username,
                ]);
                $this->gb->settleVoucherConsumption($voucher->fresh());

                return;
            }

            $reseller = $voucher->reseller_id ? User::find($voucher->reseller_id) : null;
            $percent = $reseller ? (float) $reseller->commission_percent : 0.0;
            $price = (float) $voucher->price;
            $adminShare = round($price * $percent / 100, 2);
            $resellerShare = round($price - $adminShare, 2);

            $voucher->update([
                'status' => 'sold',
                'sold_at' => now(),
                'customer_username' => $data['customer_username'] ?? $voucher->customer_username,
                'commission_percent' => $percent,
                'admin_share' => $adminShare,
                'reseller_share' => $resellerShare,
            ]);

            // Credit the admin's share of this sale straight into their wallet.
            // Attributed via the reseller's own parent, not a hardcoded root admin,
            // so this stays correct in a multi-admin setup.
            if ($adminShare > 0 && $reseller && $reseller->parent_id) {
                $admin = User::find($reseller->parent_id);
                if ($admin && $admin->isAdmin()) {
                    $this->wallet->credit(
                        $admin, $adminShare, 'commission', $voucher->code,
                        "Commission on voucher {$voucher->code} sale ({$percent}%)"
                    );
                    // The wallet credit above is an internal accrual — the reseller
                    // hasn't actually remitted this cash yet, so it stays on their
                    // books as owed until a real settlement is recorded.
                    $reseller->increment('commission_due', $adminShare);
                }
            }
        });

        return $this->ok($voucher->fresh(), 'Voucher marked as sold.');
    }

    /** Redeem a voucher to load GB balance (reseller/seller). Consumes the voucher. */
    public function redeem(Request $request): JsonResponse
    {
        if (! $request->user()->tokenCan('vouchers.redeem')) {
            return $this->fail("This API token does not have the 'vouchers.redeem' ability.", 403);
        }

        $data = $request->validate([
            'code' => ['required', 'string', 'exists:vouchers,code'],
        ]);

        $voucher = Voucher::where('code', $data['code'])->firstOrFail();

        if (! in_array($voucher->status, ['active', 'sold'], true)) {
            return $this->fail('Voucher is already used, expired or disabled.', 422);
        }

        if (! $voucher->data_gb || (float) $voucher->data_gb <= 0) {
            return $this->fail('This voucher card does not contain a GB quota.', 422);
        }

        $user = $request->user();

        if ($user->isAdmin()) {
            return $this->fail('Admin accounts cannot redeem vouchers.', 422);
        }

        DB::transaction(function () use ($voucher, $user) {
            $u = User::whereKey($user->id)->lockForUpdate()->first();

            $voucher->update([
                'status' => 'used',
                'activated_at' => now(),
                'customer_username' => $u->username,
            ]);

            $u->increment('gb_balance', $voucher->data_gb);
            $u->refresh();

            DB::table('radcheck')->where('username', $voucher->username)->delete();
            DB::table('radreply')->where('username', $voucher->username)->delete();

            \App\Models\GbTransaction::create([
                'user_id' => $u->id,
                'type' => 'allocate',
                'gb_amount' => $voucher->data_gb,
                'balance_after' => $u->gb_balance,
                'from_user_id' => $voucher->owner_id,
                'to_user_id' => $u->id,
                'reference' => 'voucher:' . $voucher->code,
                'note' => 'Redeemed voucher card ' . $voucher->code,
            ]);
        });

        return $this->ok([
            'gb_balance' => $user->fresh()->gb_balance,
            'redeemed_gb' => (float) $voucher->data_gb,
        ], "Voucher card {$voucher->code} successfully redeemed. Added {$voucher->data_gb} GB.");
    }

    // --- Scoping helpers ---

    private function scopedQuery(User $actor)
    {
        $q = Voucher::query();
        if ($actor->isReseller()) {
            $q->where('reseller_id', $actor->id);
            if (! $this->isFullAccessToken($actor)) {
                $q->where('owner_id', $actor->id);
            }
        } elseif ($actor->isSeller()) {
            $q->where('seller_id', $actor->id);
        }

        return $q; // admin: unrestricted
    }

    private function canAccess(User $actor, Voucher $v): bool
    {
        if ($actor->isAdmin()) {
            return true;
        }
        if ($actor->isReseller()) {
            if (! $this->isFullAccessToken($actor)) {
                return $v->owner_id === $actor->id;
            }

            return $v->reseller_id === $actor->id;
        }

        return $actor->isSeller() && $v->seller_id === $actor->id;
    }
}
