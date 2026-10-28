<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Supports radius:prune-accounting.
 *
 * radacct_archive is a structural copy of radacct (same columns and indexes)
 * that old PPPoE sessions are moved into, so the hot table stays small enough
 * for FreeRADIUS's per-request lookups and the buffer pool.
 *
 * radacct_usage_rollup keeps each username's lifetime totals for the sessions
 * that were moved, so "total used" figures stay correct after the rows leave
 * radacct. The readers add it to their SUM over radacct.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('radacct_archive')) {
            DB::statement('CREATE TABLE radacct_archive LIKE radacct');
        }

        Schema::create('radacct_usage_rollup', function ($table) {
            $table->string('username', 64)->primary();
            $table->unsignedBigInteger('session_count')->default(0);
            $table->unsignedBigInteger('input_octets')->default(0);
            $table->unsignedBigInteger('output_octets')->default(0);
            $table->unsignedBigInteger('session_time')->default(0);
            $table->dateTime('first_start')->nullable();
            $table->dateTime('last_start')->nullable();
            $table->dateTime('last_stop')->nullable();
            $table->timestamp('updated_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('radacct_usage_rollup');
        Schema::dropIfExists('radacct_archive');
    }
};
