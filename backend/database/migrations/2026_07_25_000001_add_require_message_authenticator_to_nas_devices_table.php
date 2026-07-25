<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    // Passthrough of FreeRADIUS's own client{} `require_message_authenticator`
    // values (BlastRADIUS / CVE-2024-3596 hardening). 'auto' matches the
    // server-wide default: require it once a client is observed sending it,
    // without breaking devices that don't support it yet.
    public function up(): void
    {
        Schema::table('nas_devices', function (Blueprint $table) {
            $table->enum('require_message_authenticator', ['auto', 'yes', 'no'])->default('auto')->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('nas_devices', function (Blueprint $table) {
            $table->dropColumn('require_message_authenticator');
        });
    }
};
