<?php

namespace App\Services;

use App\Models\NasDevice;
use Illuminate\Support\Facades\File;
use RuntimeException;

/**
 * Single source of truth for admin-managed NAS clients: reads and writes
 * client{} stanzas directly in FreeRADIUS's real clients.conf (bind-mounted
 * from the host in production) and requests a restart via the host's
 * systemd path-unit trigger file. Each device gets its own block, named
 * "{sanitized-name}_{id}" so it never collides with the hand-maintained
 * static clients (localhost, docker_networks, the Mikrotik test clients)
 * or with another device.
 */
class ClientsConfService
{
    public function path(): string
    {
        return env('RADIUS_CLIENTS_CONF_PATH', base_path('clients.conf'));
    }

    private function triggerPath(): string
    {
        return env('RADIUS_RESTART_TRIGGER_PATH', storage_path('app/radius-restart-trigger'));
    }

    /** @return array<int, array{name:string, ipaddr:string, secret:string, require_message_authenticator:string}> */
    public function parse(): array
    {
        $path = $this->path();
        if (!File::exists($path)) {
            return [];
        }

        // Anchored to line start (only leading whitespace allowed) so commented-out
        // example clients (`#client foo { ... }`) aren't parsed as real ones.
        preg_match_all('/^[ \t]*client\s+([a-zA-Z0-9_\-]+)\s*\{([^}]*)\}/m', File::get($path), $matches, PREG_SET_ORDER);

        return array_map(fn ($m) => $this->parseBlock($m[1], $m[2]), $matches);
    }

    private function parseBlock(string $name, string $body): array
    {
        $client = [
            'name' => $name,
            'ipaddr' => '',
            'secret' => '',
            'require_message_authenticator' => 'auto',
        ];

        foreach (explode("\n", $body) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }

            [$key, $val] = array_map('trim', explode('=', $line, 2));
            $val = trim($val, " \t\"");

            if ($key === 'ipaddr') {
                $client['ipaddr'] = $val;
            } elseif ($key === 'secret') {
                $client['secret'] = $val;
            } elseif ($key === 'require_message_authenticator') {
                $client['require_message_authenticator'] = $val;
            }
        }

        return $client;
    }

    /** Sanitized, id-suffixed client{} block identifier — stable and unique per device. */
    public function blockName(NasDevice $device): string
    {
        $base = strtolower($device->shortname ?: $device->name);
        $base = preg_replace('/[^a-z0-9_]+/', '_', $base);
        $base = trim($base, '_') ?: 'nas';

        return "{$base}_{$device->id}";
    }

    /** Upsert this device's client{} stanza, then request a FreeRADIUS restart. */
    public function upsert(NasDevice $device): void
    {
        $name = $this->blockName($device);
        $block = $this->render($name, $device);

        $this->mutate(function (string $content) use ($name, $block) {
            $pattern = '/client\s+' . preg_quote($name, '/') . '\s*\{[^}]*\}\s*/';

            return preg_match($pattern, $content)
                ? preg_replace($pattern, $block . "\n", $content)
                : rtrim($content) . "\n\n" . $block . "\n";
        });

        $this->requestRestart();
    }

    /** Remove this device's client{} stanza, then request a FreeRADIUS restart. */
    public function remove(NasDevice $device): void
    {
        $name = $this->blockName($device);

        $this->mutate(function (string $content) use ($name) {
            return preg_replace('/client\s+' . preg_quote($name, '/') . '\s*\{[^}]*\}\s*/', '', $content);
        });

        $this->requestRestart();
    }

    private function render(string $name, NasDevice $device): string
    {
        $secret = str_replace('"', '\\"', $device->secret);

        $lines = [
            "client {$name} {",
            "\tipaddr = {$device->nasname}",
            "\tsecret = \"{$secret}\"",
        ];

        if ($device->require_message_authenticator !== 'auto') {
            $lines[] = "\trequire_message_authenticator = {$device->require_message_authenticator}";
        }

        $lines[] = '}';

        return implode("\n", $lines);
    }

    /** Read-modify-write clients.conf under an exclusive lock. */
    private function mutate(callable $transform): void
    {
        $path = $this->path();
        $fp = fopen($path, 'c+');
        if ($fp === false) {
            throw new RuntimeException("Unable to open clients.conf at {$path}");
        }

        try {
            flock($fp, LOCK_EX);
            $content = stream_get_contents($fp) ?: '';
            $updated = $transform($content);

            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, $updated);
            fflush($fp);
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    public function requestRestart(): void
    {
        File::put($this->triggerPath(), (string) time());
    }
}
