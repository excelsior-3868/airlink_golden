<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A NAT'd MikroTik reports NAS-IP-Address as its own LAN address (e.g.
 * 192.168.101.3), which is what lands in radacct.nasipaddress — and is
 * unroutable from this server. nasname may also be a whole subnet rather than
 * one host. CoA needs a real address to send the Disconnect-Request to, so
 * record it explicitly per device.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nas_devices', function (Blueprint $table) {
            $table->string('coa_host')->nullable()->after('secret');
            $table->unsignedSmallInteger('coa_port')->default(3799)->after('coa_host');
        });
    }

    public function down(): void
    {
        Schema::table('nas_devices', function (Blueprint $table) {
            $table->dropColumn(['coa_host', 'coa_port']);
        });
    }
};
