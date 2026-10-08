<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\BrandingSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class BrandingSettingController extends Controller
{
    /**
     * Get branding settings (returns or creates single row).
     */
    public function show()
    {
        $setting = BrandingSetting::firstOrCreate(
            ['id' => 1],
            [
                'property_name' => 'Oxygen Restaurant and Home',
                'primary_color' => '#1e3a5f',
                'official_email' => 'oxygen@gmail.com',
                'support_phone' => '+9779851129935',
                'registered_address' => 'kathmandu Barnani',
                'pan_vat_number' => '601234567',
            ]
        );

        return response()->json($setting);
    }

    /**
     * Update branding settings.
     */
    public function update(Request $request)
    {
        $setting = BrandingSetting::firstOrCreate(['id' => 1]);

        $validated = $request->validate([
            'property_name' => 'required|string|max:255',
            'primary_color' => 'required|string|max:30',
            'official_email' => 'nullable|email|max:255',
            'support_phone' => 'nullable|string|max:50',
            'registered_address' => 'nullable|string|max:500',
            'pan_vat_number' => 'nullable|string|max:100',
            'logo_url' => 'nullable|string',
            'pppoe_only' => 'sometimes|boolean',
            'logo_file' => 'nullable|image|max:5120', // 5MB max
        ]);

        if ($request->hasFile('logo_file')) {
            $path = $request->file('logo_file')->store('branding', 'public');
            $validated['logo_url'] = '/storage/' . $path;
        }

        unset($validated['logo_file']);

        // Service mode is a system-wide switch: only an admin may flip it, even though
        // resellers/sellers can edit the rest of the branding.
        if ($request->user()?->role !== 'admin') {
            unset($validated['pppoe_only']);
        }

        $setting->update($validated);

        return response()->json([
            'message' => 'Branding settings saved successfully',
            'data' => $setting->fresh(),
        ]);
    }
}
