<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Drive voucher lifecycle (active/expired) every 5 minutes.
Schedule::command('vouchers:sync-status')->everyFiveMinutes()->withoutOverlapping();

// Drive PPPoE subscriber lifecycle (active/expired) every 5 minutes.
Schedule::command('pppoe:sync-status')->everyFiveMinutes()->withoutOverlapping();

// Settle GB Package vouchers activated (first login) outside an explicit sale.
Schedule::command('vouchers:settle-gb')->everyFiveMinutes()->withoutOverlapping();

// Close radacct sessions the NAS abandoned without an Accounting-Stop. Left to
// accumulate they inflate the online-user count and, because FreeRADIUS counts
// them in simul_count_query, one stale row blocks that voucher's next login.
Schedule::command('radius:close-stale-sessions')->everyFiveMinutes()->withoutOverlapping();
