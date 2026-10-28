<?php

namespace Tests\Feature;

use App\Models\InternetPlan;
use App\Models\PppoeCustomer;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PruneAccountingTest extends TestCase
{
    use DatabaseTransactions;

    private function pppoe(string $username): void
    {
        $admin = \App\Models\User::first() ?? $this->makeUser('admin');
        $plan = InternetPlan::first() ?? InternetPlan::create([
            'name' => 'P', 'plan_type' => 'time', 'selling_price' => 1, 'validity_days' => 30, 'status' => 'active',
        ]);
        PppoeCustomer::create([
            'full_name' => $username, 'username' => $username, 'password' => 'x', 'plan_id' => $plan->id,
            'owner_id' => $admin->id, 'reseller_id' => $admin->id, 'contract_price' => 1,
            'status' => 'active', 'activated_at' => now()->subYear(),
        ]);
    }

    private function addSession(string $username, string $uid, $start, $stop, int $in, int $out): void
    {
        DB::table('radacct')->insert([
            'acctsessionid' => $uid, 'acctuniqueid' => $uid, 'username' => $username, 'nasipaddress' => '10.0.0.1',
            'acctstarttime' => $start, 'acctstoptime' => $stop, 'acctsessiontime' => 60,
            'acctinputoctets' => $in, 'acctoutputoctets' => $out,
        ]);
    }

    public function test_dry_run_changes_nothing(): void
    {
        $this->pppoe('NTP1');
        $this->addSession('NTP1', 'a', now()->subDays(200), now()->subDays(200)->addHour(), 10, 20);

        Artisan::call('radius:prune-accounting');

        $this->assertSame(1, DB::table('radacct')->count());
        $this->assertSame(0, DB::table('radacct_archive')->count());
    }

    public function test_old_closed_pppoe_rows_are_archived_and_totals_rolled_up(): void
    {
        $this->pppoe('NTP1');
        $this->addSession('NTP1', 'old1', now()->subDays(200), now()->subDays(200)->addHour(), 10, 20);
        $this->addSession('NTP1', 'old2', now()->subDays(150), now()->subDays(150)->addHour(), 5, 5);
        $this->addSession('NTP1', 'recent', now()->subDays(5), now()->subDays(5)->addHour(), 1, 1);
        $this->addSession('NTP1', 'open', now()->subDays(300), null, 7, 7); // never closed: left alone

        Artisan::call('radius:prune-accounting', ['--apply' => true, '--days' => 90]);

        $this->assertEqualsCanonicalizing(['recent', 'open'], DB::table('radacct')->pluck('acctuniqueid')->all());
        $this->assertEqualsCanonicalizing(['old1', 'old2'], DB::table('radacct_archive')->pluck('acctuniqueid')->all());

        $roll = DB::table('radacct_usage_rollup')->where('username', 'NTP1')->first();
        $this->assertSame(2, (int) $roll->session_count);
        $this->assertSame(15, (int) $roll->input_octets);
        $this->assertSame(25, (int) $roll->output_octets);
    }

    public function test_a_second_run_adds_to_the_rollup_instead_of_replacing_it(): void
    {
        $this->pppoe('NTP1');
        $this->addSession('NTP1', 'a', now()->subDays(200), now()->subDays(200)->addHour(), 10, 0);
        Artisan::call('radius:prune-accounting', ['--apply' => true]);
        $this->addSession('NTP1', 'b', now()->subDays(190), now()->subDays(190)->addHour(), 4, 0);
        Artisan::call('radius:prune-accounting', ['--apply' => true]);

        $roll = DB::table('radacct_usage_rollup')->where('username', 'NTP1')->first();
        $this->assertSame(2, (int) $roll->session_count);
        $this->assertSame(14, (int) $roll->input_octets);
    }

    public function test_voucher_and_unknown_usernames_are_never_archived(): void
    {
        // Not a PPPoE customer (e.g. a hotspot voucher user): its history drives quota.
        $this->addSession('hotspot-user', 'h1', now()->subDays(200), now()->subDays(200)->addHour(), 10, 20);

        Artisan::call('radius:prune-accounting', ['--apply' => true]);

        $this->assertSame(1, DB::table('radacct')->count());
        $this->assertSame(0, DB::table('radacct_archive')->count());
    }

    public function test_old_login_attempts_are_trimmed(): void
    {
        DB::table('radpostauth')->insert([
            ['username' => 'a', 'pass' => '', 'reply' => 'Access-Accept', 'authdate' => now()->subDays(60)],
            ['username' => 'b', 'pass' => '', 'reply' => 'Access-Accept', 'authdate' => now()->subDays(2)],
        ]);

        Artisan::call('radius:prune-accounting', ['--apply' => true, '--postauth-days' => 30]);

        $this->assertSame(['b'], DB::table('radpostauth')->pluck('username')->all());
    }
}
