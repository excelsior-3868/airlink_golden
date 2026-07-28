<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Standard FreeRADIUS 3.x `nasreload` table — LEFT-JOINed by the stock
 * simul_count_query/simul_verify_query (mods-config/sql/main/mysql/queries.conf)
 * used for Simultaneous-Use checking. Column names/types match the upstream
 * schema.sql exactly. The table can stay empty: our accounting{} block uses
 * the "bulk update" Accounting-On/Off strategy (closes radacct rows directly),
 * not the nasreload-based one, so this only needs to exist for the JOIN.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('nasreload', function (Blueprint $table) {
            $table->string('nasipaddress', 15);
            $table->dateTime('reloadtime');
            $table->primary('nasipaddress');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('nasreload');
    }
};
