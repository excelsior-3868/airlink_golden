<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Drive voucher lifecycle (active/expired) every 5 minutes.
Schedule::command('vouchers:sync-status')->everyFiveMinutes()->withoutOverlapping();

// Settle GB Package vouchers activated (first login) outside an explicit sale.
Schedule::command('vouchers:settle-gb')->everyFiveMinutes()->withoutOverlapping();
