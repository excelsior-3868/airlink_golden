<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class TotpReset extends Command
{
    protected $signature = 'totp:reset {username : Username whose authenticator should be cleared}';

    protected $description = 'Clear a user\'s two-factor (TOTP) enrolment, e.g. when the last admin loses their phone';

    public function handle(): int
    {
        $user = User::where('username', $this->argument('username'))->first();
        if (! $user) {
            $this->error('User not found.');

            return self::FAILURE;
        }

        $user->forceFill([
            'totp_secret' => null,
            'totp_confirmed_at' => null,
            'totp_recovery_codes' => null,
            'totp_last_step' => null,
        ])->save();
        $user->tokens()->where('name', 'portal')->delete();

        $this->info("Two-factor cleared for {$user->username}; they will re-enrol at next login if their role requires it.");

        return self::SUCCESS;
    }
}
