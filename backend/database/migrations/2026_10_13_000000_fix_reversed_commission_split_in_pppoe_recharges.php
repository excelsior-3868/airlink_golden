<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::transaction(function () {
            $recharges = DB::table('pppoe_recharges')
                ->whereNotNull('reseller_id')
                ->get();

            foreach ($recharges as $r) {
                $price = (float) $r->price;
                $pct = (float) $r->commission_percent;
                if ($price <= 0 || $pct <= 0) {
                    continue;
                }

                // Reseller gets $pct%, admin gets the remainder
                $newResellerShare = round($price * $pct / 100, 2);
                $newAdminShare = round($price - $newResellerShare, 2);
                $oldAdminShare = (float) $r->admin_share;
                $diff = round($newAdminShare - $oldAdminShare, 2);

                DB::table('pppoe_recharges')->where('id', $r->id)->update([
                    'admin_share' => $newAdminShare,
                    'reseller_share' => $newResellerShare,
                ]);

                DB::table('wallet_transactions')
                    ->where('reference', $r->reference)
                    ->where('type', 'commission')
                    ->update([
                        'amount' => $newAdminShare,
                    ]);

                if ($r->reseller_id && $diff != 0) {
                    DB::table('users')->where('id', $r->reseller_id)->increment('commission_due', $diff);
                }

                if ($diff != 0) {
                    $reseller = DB::table('users')->where('id', $r->reseller_id)->first();
                    $adminId = $reseller?->parent_id ?: 1;
                    DB::table('users')->where('id', $adminId)->increment('wallet_balance', $diff);
                }
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::transaction(function () {
            $recharges = DB::table('pppoe_recharges')
                ->whereNotNull('reseller_id')
                ->get();

            foreach ($recharges as $r) {
                $price = (float) $r->price;
                $pct = (float) $r->commission_percent;
                if ($price <= 0 || $pct <= 0) {
                    continue;
                }

                // Invert back
                $oldResellerShare = round($price * (100 - $pct) / 100, 2);
                $oldAdminShare = round($price - $oldResellerShare, 2);
                $currentAdminShare = (float) $r->admin_share;
                $diff = round($oldAdminShare - $currentAdminShare, 2);

                DB::table('pppoe_recharges')->where('id', $r->id)->update([
                    'admin_share' => $oldAdminShare,
                    'reseller_share' => $oldResellerShare,
                ]);

                DB::table('wallet_transactions')
                    ->where('reference', $r->reference)
                    ->where('type', 'commission')
                    ->update([
                        'amount' => $oldAdminShare,
                    ]);

                if ($r->reseller_id && $diff != 0) {
                    DB::table('users')->where('id', $r->reseller_id)->increment('commission_due', $diff);
                }

                if ($diff != 0) {
                    $reseller = DB::table('users')->where('id', $r->reseller_id)->first();
                    $adminId = $reseller?->parent_id ?: 1;
                    DB::table('users')->where('id', $adminId)->increment('wallet_balance', $diff);
                }
            }
        });
    }
};
