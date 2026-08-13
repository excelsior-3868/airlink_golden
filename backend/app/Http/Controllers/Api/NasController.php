<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\NasDevice;
use App\Services\ClientsConfService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * MikroTik router / NAS registry (admin-only). Each device is written as its
 * own client{} stanza in the real FreeRADIUS clients.conf via ClientsConfService
 * — the single source of truth for RADIUS clients, since FreeRADIUS's SQL-loaded
 * ('nas' table) clients can't carry per-client settings like
 * require_message_authenticator.
 */
class NasController extends Controller
{
    public function __construct(private ClientsConfService $clientsConf) {}

    public function index(): JsonResponse
    {
        $activity = app(\App\Services\Radius\NasActivityService::class)->forDevices();

        // Whether a NAS is really talking to FreeRADIUS cannot be read from
        // radacct — see NasActivityService for why the detail files are the
        // only source that ties a router's real address to the one it reports.
        $devices = NasDevice::with('owner')->orderBy('name')->get()
            ->each(fn (NasDevice $d) => $d->setAttribute('activity', $activity[$d->id] ?? null));

        return $this->ok($devices);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateData($request);
        $device = null;
        DB::transaction(function () use ($data, &$device) {
            $device = NasDevice::create($data);
        });

        $this->clientsConf->upsert($device);

        return $this->created($device, 'NAS device created.');
    }

    public function update(Request $request, NasDevice $nas): JsonResponse
    {
        $data = $this->validateData($request, $nas->id);
        $nas->update($data);
        $this->clientsConf->upsert($nas);

        return $this->ok($nas, 'NAS device updated.');
    }

    public function destroy(NasDevice $nas): JsonResponse
    {
        $this->clientsConf->remove($nas);
        $nas->delete();

        return $this->ok(null, 'NAS device deleted.');
    }

    private function validateData(Request $request, ?int $id = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'nasname' => ['required', 'string', 'max:255'],
            'shortname' => ['nullable', 'string', 'max:255'],
            'type' => ['nullable', 'string', 'max:50'],
            'secret' => ['required', 'string', 'max:255'],
            'coa_host' => ['nullable', 'string', 'max:255'],
            'coa_port' => ['nullable', 'integer', 'min:1', 'max:65535'],
            'api_ip' => ['nullable', 'string', 'max:255'],
            'api_username' => ['nullable', 'string', 'max:255'],
            'api_password' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'in:active,disabled'],
            'require_message_authenticator' => ['nullable', 'in:auto,yes,no'],
            'owner_id' => ['nullable', 'exists:users,id'],
        ]);
    }
}
