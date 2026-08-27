<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Realign vouchers.status with the four stages the enum has always declared
 * (see 2026_08_09_000001_update_voucher_lifecycle_stages):
 *
 *   ready    generated / in stock, never logged in
 *   active   customer has logged in — the card is in use
 *   used     spent: validity window over, or data quota exhausted
 *   disabled revoked by admin/reseller
 *
 * Two writers had drifted from that and are corrected in the same change as
 * this migration:
 *
 *  1. The FreeRADIUS post-auth hook stamped status='used' on a customer's
 *     FIRST successful login (it read 'used' as "activated"). Every card in
 *     service therefore showed as spent the moment it was used once, while
 *     'active' stayed empty. Fixed to write 'active'.
 *
 *  2. LegacyImport created imported stock as 'active' — a deliberate
 *     workaround for the old post-auth WHERE clause, which matched
 *     ('active','sold','used') and so would never have started the clock on a
 *     card left on 'new'. post-auth now matches ('ready','active'), so the
 *     workaround is gone and imported stock lands on 'ready'.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Cards wrongly marked spent by the old post-auth hook: still
        //    inside their validity window, still under their data cap, and
        //    still holding RADIUS credentials. The credentials test is what
        //    separates these from genuinely terminal cards — vouchers:sync-status
        //    and VoucherController@redeem both delete radcheck/radreply when
        //    they retire a card, so a 'used' row that still has a
        //    Cleartext-Password was never actually retired by anything. Without
        //    that guard this would also resurrect redeemed cards, whose GB has
        //    already been paid out into a wallet balance.
        $revived = DB::update(
            "UPDATE vouchers v
             SET v.status = 'active', v.updated_at = NOW()
             WHERE v.status = 'used'
               AND v.void_reason IS NULL
               AND v.activated_at IS NOT NULL
               AND (v.expires_at IS NULL OR v.expires_at > NOW())
               AND (
                   v.data_gb IS NULL OR v.data_gb <= 0
                   OR IFNULL((
                       SELECT SUM(r.acctinputoctets + r.acctoutputoctets)
                       FROM radacct r WHERE r.username = v.username
                   ), 0) < v.data_gb * 1073741824
               )
               AND EXISTS (
                   SELECT 1 FROM radcheck rc
                   WHERE rc.username = v.username
                     AND rc.attribute = 'Cleartext-Password'
               )"
        );

        // 2. Imported stock parked on 'active' that has never been logged into
        //    and never been sold — that is 'ready' by definition.
        //
        //    sold_at IS NULL matters: VoucherController@sell also writes
        //    'active' (with sold_at, commission split and GB settlement), and
        //    reports count a card as sold via status IN ('active','used').
        //    Demoting a sold card to 'ready' would take it back out of the
        //    sales figures and re-offer it as sellable stock.
        $destocked = DB::update(
            "UPDATE vouchers
             SET status = 'ready', updated_at = NOW()
             WHERE status = 'active'
               AND void_reason IS NULL
               AND activated_at IS NULL
               AND sold_at IS NULL"
        );

        // Cards on 'used' with no activated_at and no credentials are left
        // alone: nothing can tell them apart from correctly-retired stock, and
        // reviving one without credentials would not put it back in service
        // anyway.
        echo "Voucher lifecycle realigned: {$revived} in-use cards moved used → active, "
            . "{$destocked} unsold cards moved active → ready.\n";
    }

    public function down(): void
    {
        // Deliberately not reversed. Both statements above collapse
        // distinguishable states into one another ('used' meant both "in use"
        // and "spent" before this ran), so there is no derivation that puts
        // the old values back without re-corrupting the correct ones. The
        // stages here are the ones the enum and the whole reporting layer
        // already assume; rolling back would mean re-introducing the bug.
    }
};
