<?php

namespace App\Services\Radius;

use App\Models\NasDevice;
use Illuminate\Support\Carbon;

/**
 * Whether each registered NAS is actually talking to the RADIUS server.
 *
 * radacct cannot answer this on its own. It records the NAS-IP-Address a router
 * puts *inside* its packets, which on this deployment is a private address
 * behind a firewall — 103.167.229.98 reports itself as 172.22.22.4, .5 and .10.
 * So a NAS can be perfectly healthy and still appear nowhere in radacct under
 * the address it is registered with.
 *
 * FreeRADIUS's detail files are filed by the real source address, so they are
 * the only place the two identities meet: the directory name is who connected,
 * the NAS-IP-Address inside is who they claim to be.
 */
class NasActivityService
{
    /** Root of FreeRADIUS's per-NAS accounting detail directories. */
    private const DETAIL_ROOT = '/var/log/freeradius/radacct';

    /** Bytes to sample from the end of a detail file when reading reported addresses. */
    private const TAIL_BYTES = 262144;

    /** Minutes of silence before a NAS is flagged. Routers here interim-update hourly. */
    private const QUIET_AFTER_MINUTES = 90;

    /**
     * Activity for every registered NAS, keyed by device id.
     *
     * @return array<int, array<string, mixed>>
     */
    public function forDevices(): array
    {
        $sources = $this->scanSources();
        $out = [];

        foreach (NasDevice::all() as $device) {
            $matched = array_filter(
                $sources,
                fn (array $s) => $this->belongsTo($s['source_ip'], $device)
            );

            $lastSeen = null;
            $reported = [];
            $packets = 0;
            foreach ($matched as $s) {
                if ($s['last_seen'] && (! $lastSeen || $s['last_seen']->gt($lastSeen))) {
                    $lastSeen = $s['last_seen'];
                }
                $reported = array_merge($reported, $s['reported']);
                $packets += $s['packets_today'];
            }

            $out[$device->id] = [
                'sources' => array_values(array_column($matched, 'source_ip')),
                'reported_nas_ips' => array_values(array_unique($reported)),
                'packets_today' => $packets,
                'last_seen' => $lastSeen?->toIso8601String(),
                'minutes_since' => $lastSeen ? $lastSeen->diffInMinutes(now()) : null,
                'state' => $this->state($lastSeen),
            ];
        }

        return $out;
    }

    /**
     * Source addresses that have ever sent accounting, with what they reported.
     *
     * @return array<int, array{source_ip:string, last_seen:?Carbon, reported:array<int,string>, packets_today:int}>
     */
    private function scanSources(): array
    {
        if (! is_dir(self::DETAIL_ROOT)) {
            return [];
        }

        $sources = [];
        foreach (glob(self::DETAIL_ROOT.'/*', GLOB_ONLYDIR) ?: [] as $dir) {
            $files = glob($dir.'/detail-*') ?: [];
            if (! $files) {
                continue;
            }

            // Newest file wins; its mtime is when this NAS last sent anything.
            usort($files, fn ($a, $b) => filemtime($b) <=> filemtime($a));
            $newest = $files[0];

            $sources[] = [
                'source_ip' => basename($dir),
                'last_seen' => Carbon::createFromTimestamp(filemtime($newest)),
                'reported' => $this->reportedAddresses($newest),
                'packets_today' => $this->packetsToday($dir),
            ];
        }

        return $sources;
    }

    /**
     * NAS-IP-Address values a router is currently reporting.
     *
     * Only the tail is read — these files reach tens of megabytes a day, and the
     * recent end is what reflects the router's present behaviour anyway.
     *
     * @return array<int, string>
     */
    private function reportedAddresses(string $file): array
    {
        $handle = @fopen($file, 'r');
        if (! $handle) {
            return [];
        }

        $size = filesize($file) ?: 0;
        if ($size > self::TAIL_BYTES) {
            fseek($handle, -self::TAIL_BYTES, SEEK_END);
            fgets($handle); // discard the partial line the seek landed in
        }
        $tail = stream_get_contents($handle) ?: '';
        fclose($handle);

        preg_match_all('/NAS-IP-Address = ([0-9.]+)/', $tail, $m);

        return array_values(array_unique($m[1] ?? []));
    }

    private function packetsToday(string $dir): int
    {
        $file = $dir.'/detail-'.now()->format('Ymd');
        if (! is_readable($file)) {
            return 0;
        }

        $count = 0;
        $handle = fopen($file, 'r');
        while (($line = fgets($handle)) !== false) {
            if (str_contains($line, 'Acct-Status-Type')) {
                $count++;
            }
        }
        fclose($handle);

        return $count;
    }

    /** Does this source address belong to the device — directly, or inside its subnet? */
    private function belongsTo(string $sourceIp, NasDevice $device): bool
    {
        foreach ([$device->nasname, $device->coa_host] as $candidate) {
            if (! $candidate) {
                continue;
            }
            if ($candidate === $sourceIp) {
                return true;
            }
            if (str_contains($candidate, '/') && $this->inCidr($sourceIp, $candidate)) {
                return true;
            }
        }

        return false;
    }

    private function inCidr(string $ip, string $cidr): bool
    {
        [$subnet, $bits] = array_pad(explode('/', $cidr, 2), 2, '32');
        $ipLong = ip2long($ip);
        $subnetLong = ip2long($subnet);
        $bits = (int) $bits;

        if ($ipLong === false || $subnetLong === false || $bits < 0 || $bits > 32) {
            return false;
        }

        $mask = $bits === 0 ? 0 : -1 << (32 - $bits);

        return ($ipLong & $mask) === ($subnetLong & $mask);
    }

    private function state(?Carbon $lastSeen): string
    {
        if (! $lastSeen) {
            return 'never';
        }

        return $lastSeen->gt(now()->subMinutes(self::QUIET_AFTER_MINUTES)) ? 'active' : 'silent';
    }
}
