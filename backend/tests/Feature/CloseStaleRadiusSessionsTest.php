<?php

namespace Tests\Feature;

use App\Services\Radius\CoaClient;
use App\Services\Radius\CoaService;
use App\Services\Radius\OnlineSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class CloseStaleRadiusSessionsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Bind the CoA mock before any Artisan call — the console kernel caches
     * command instances with whatever CoaService was bound when it first ran.
     *
     * @param array<int, string> $statuses one CoaClient::PROBE_* per probe, in order
     */
    private function fakeCoa(array $statuses): void
    {
        $mock = \Mockery::mock(CoaService::class);
        $call = $mock->shouldReceive('probeSession');

        if ($statuses === []) {
            $call->never();
        } else {
            $call->times(count($statuses))->andReturn(...array_map(
                fn (string $s) => ['status' => $s, 'session_id' => null, 'nas_ip' => null, 'coa_target' => '10.0.0.1:3799', 'reason' => null],
                $statuses,
            ));
        }

        $this->app->instance(CoaService::class, $mock);
    }

    private function openSession(string $username, int $idleMinutes, int $bytes = 0): int
    {
        $at = now()->subMinutes($idleMinutes);

        return DB::table('radacct')->insertGetId([
            'acctsessionid' => 'sess-'.$username,
            'acctuniqueid' => md5($username.$idleMinutes),
            'username' => $username,
            'nasipaddress' => '110.34.1.63',
            'acctstarttime' => $at,
            'acctupdatetime' => $at,
            'acctstoptime' => null,
            'acctinputoctets' => $bytes,
            'acctoutputoctets' => 0,
            'callingstationid' => 'AA:BB:CC:DD:EE:FF',
        ]);
    }

    private function row(int $id): object
    {
        return DB::table('radacct')->where('radacctid', $id)->first();
    }

    public function test_closes_session_the_nas_says_it_does_not_have(): void
    {
        $this->fakeCoa([CoaClient::PROBE_NOT_FOUND]);
        $id = $this->openSession('PHANTOM', 90);

        Artisan::call('radius:close-stale-sessions');

        $row = $this->row($id);
        $this->assertNotNull($row->acctstoptime, 'A NAS-confirmed dead session should be closed.');
        $this->assertSame('NAS-Error', $row->acctterminatecause);
        // Backdated to the last sign of life so acctsessiontime stays honest.
        $this->assertSame(0, (int) $row->acctsessiontime);
    }

    public function test_session_the_nas_vouches_for_survives_even_past_the_blind_backstop(): void
    {
        // The regression that matters: over 45 days, 85 sessions ran for hours
        // with no interim update while moving real traffic. They are
        // indistinguishable in radacct from an abandoned row, so only the
        // router's answer may save them — and it must outrank the 12-hour
        // timeout, not merely delay it.
        $this->fakeCoa([CoaClient::PROBE_ALIVE]);
        $id = $this->openSession('LIVE_BUT_SILENT', OnlineSession::CLOSE_AFTER_MINUTES + 120);

        Artisan::call('radius:close-stale-sessions');

        $this->assertNull($this->row($id)->acctstoptime, 'A live session must never be closed, however quiet.');
    }

    public function test_unanswered_probe_falls_back_to_the_blind_backstop(): void
    {
        // CoA unreachable (router has not enabled incoming RADIUS, link down,
        // NAS unregistered): we learned nothing, so the old timid rule stands.
        $this->fakeCoa([CoaClient::PROBE_UNKNOWN, CoaClient::PROBE_UNKNOWN]);
        $recent = $this->openSession('QUIET_RECENT', 90);
        $ancient = $this->openSession('QUIET_ANCIENT', OnlineSession::CLOSE_AFTER_MINUTES + 60);

        Artisan::call('radius:close-stale-sessions');

        $this->assertNull($this->row($recent)->acctstoptime, 'Under the backstop window it stays open.');
        $this->assertNotNull($this->row($ancient)->acctstoptime, 'Past the backstop window it still closes.');
    }

    public function test_no_probe_option_restores_pure_backstop_behaviour(): void
    {
        $this->fakeCoa([]); // probeSession must never be called
        $id = $this->openSession('PHANTOM', 90);

        Artisan::call('radius:close-stale-sessions', ['--no-probe' => true]);

        $this->assertNull($this->row($id)->acctstoptime);
    }

    public function test_sessions_quieter_than_the_probe_window_are_left_alone(): void
    {
        $this->fakeCoa([]);
        $id = $this->openSession('FRESH', OnlineSession::PROBE_AFTER_MINUTES - 5);

        Artisan::call('radius:close-stale-sessions');

        $this->assertNull($this->row($id)->acctstoptime);
    }

    public function test_probe_batch_is_capped_and_prefers_the_quietest(): void
    {
        // Only one probe may go out; it must be spent on the quietest session,
        // and the un-probed one must survive untouched until the next tick.
        $this->fakeCoa([CoaClient::PROBE_NOT_FOUND]);
        $quietest = $this->openSession('QUIETEST', 400);
        $lessQuiet = $this->openSession('LESS_QUIET', 30);

        Artisan::call('radius:close-stale-sessions', ['--max-probes' => 1]);

        $this->assertNotNull($this->row($quietest)->acctstoptime);
        $this->assertNull($this->row($lessQuiet)->acctstoptime);
    }

    public function test_ambiguous_nak_is_trusted_once_the_same_nas_confirms_a_live_session(): void
    {
        // RouterOS answers a probe for a session it does not have with
        // Error-Cause 406, not the standard 503. That is only meaningful
        // because the same router ACKs probes for sessions it does have — so
        // one ACK from the NAS turns its NAKs into evidence.
        $this->fakeCoa([CoaClient::PROBE_ALIVE, CoaClient::PROBE_REJECTED]);
        $live = $this->openSession('LIVE', 400);
        $phantom = $this->openSession('PHANTOM', 90);

        Artisan::call('radius:close-stale-sessions');

        $this->assertNull($this->row($live)->acctstoptime);
        $this->assertNotNull($this->row($phantom)->acctstoptime, 'A corroborated NAK should close the row.');
    }

    public function test_ambiguous_nak_alone_is_not_enough_to_close(): void
    {
        // The failure mode this guards: a NAS that NAKs every probe because it
        // does not support them would otherwise report all its live sessions
        // as dead and get them all closed.
        $this->fakeCoa([CoaClient::PROBE_REJECTED]);
        $id = $this->openSession('UNCORROBORATED', 90);

        Artisan::call('radius:close-stale-sessions');

        $this->assertNull($this->row($id)->acctstoptime, 'An uncorroborated NAK must not close anything.');
    }

    public function test_dry_run_probes_but_writes_nothing(): void
    {
        $this->fakeCoa([CoaClient::PROBE_NOT_FOUND]);
        $id = $this->openSession('PHANTOM', 90);

        Artisan::call('radius:close-stale-sessions', ['--dry-run' => true]);

        $this->assertNull($this->row($id)->acctstoptime, 'A dry run may ask the NAS, but must not write.');
    }
}
