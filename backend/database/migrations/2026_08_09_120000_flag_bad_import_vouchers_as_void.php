<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Marks the 137,224 rows the original import should never have created.
 *
 * They came from tbl_customers, which is a historical archive of every code
 * ever issued rather than the live credential set — legacy had already deleted
 * their radcheck rows, so they could not authenticate before the cutover. The
 * import regenerated credentials for all of them; a containment pass then
 * disabled them and removed those credentials again.
 *
 * They stay in the table so the bad import remains auditable and reversible,
 * but they are not vouchers and must not appear in any count — including the
 * `disabled` figure, which otherwise reads 138,692 when only 1,468 cards have
 * genuinely been disabled.
 *
 * `void_reason` is stamped once here rather than recomputed from "disabled and
 * has no radcheck row". That join is true today but would silently
 * misclassify a genuine card that later loses its credential.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->string('void_reason')->nullable()->after('status');
            $table->index('void_reason');
        });

        DB::statement(
            "UPDATE vouchers v
             LEFT JOIN radcheck rc
                    ON rc.username = v.username AND rc.attribute = 'Cleartext-Password'
             SET v.void_reason = 'bad-import: no credential in legacy radcheck'
             WHERE v.status = 'disabled'
               AND rc.username IS NULL"
        );
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropIndex(['void_reason']);
            $table->dropColumn('void_reason');
        });
    }
};
