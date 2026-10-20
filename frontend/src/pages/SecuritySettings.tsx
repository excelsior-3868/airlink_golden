import { useEffect, useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { datet } from '../lib/format'
import { PageTitle, GlassCard, Pill } from '../components/ui'

interface EnrolledUser {
  id: number
  name: string
  username: string
  role: string
  status: string
  totp_confirmed_at: string | null
}

interface TotpState {
  required_roles: string[]
  eligible_roles: string[]
  users: EnrolledUser[]
}

export default function SecuritySettings() {
  const [state, setState] = useState<TotpState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    api.get('/admin/security/totp').then((r) => setState(r.data.data)).catch((e) => setErr(apiError(e)))
  }, [])

  const run = async (fn: () => Promise<any>) => {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const r = await fn()
      setState(r.data.data)
      setMsg(r.data.message || 'Saved.')
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleRole = (role: string) => {
    if (!state) return
    const next = state.required_roles.includes(role)
      ? state.required_roles.filter((r) => r !== role)
      : [...state.required_roles, role]
    run(() => api.put('/admin/security/totp', { required_roles: next }))
  }

  const reset = (u: EnrolledUser) => {
    if (!window.confirm(`Reset two-factor for ${u.username}? They will be signed out and must set it up again at next login.`)) return
    run(() => api.post(`/admin/security/totp/reset/${u.id}`))
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="Security"
        subtitle="Two-factor authentication (Google Authenticator or any TOTP app)"
        icon={<ShieldCheck size={20} />}
      />

      {err && <div className="pill danger w-full justify-center py-2.5 text-xs font-semibold">{err}</div>}
      {msg && <div className="pill success w-full justify-center py-2.5 text-xs font-semibold">{msg}</div>}

      {!state ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <GlassCard className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Require two-factor sign-in</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Users in a selected role are asked to scan a QR code at their next login, then enter a 6-digit code every time they sign in.
              Turning a role off stops enforcing it for users who have not set it up; users who already did keep being asked until you reset them below.
            </p>
            {state.eligible_roles.map((role) => (
              <label key={role} className="flex items-center gap-3 text-sm text-slate-800 dark:text-slate-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded border-slate-300"
                  checked={state.required_roles.includes(role)}
                  disabled={busy}
                  onChange={() => toggleRole(role)}
                />
                <span className="capitalize">{role}s</span>
              </label>
            ))}
          </GlassCard>

          <GlassCard className="p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Reset an authenticator</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Use this when a user loses their phone or changes it. Resetting signs them out and clears their authenticator and recovery codes;
              they scan a new QR code at their next login. Only administrators can do this.
            </p>
            <input
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm py-2 px-3 text-slate-900 dark:text-slate-100"
              placeholder="Search admins and resellers…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {(() => {
              const needle = q.trim().toLowerCase()
              const rows = state.users.filter(
                (u) => !needle || u.username.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle),
              )
              if (rows.length === 0) return <p className="text-xs text-slate-500 dark:text-slate-400">No matching users.</p>
              return (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{u.name} <span className="text-slate-400">@{u.username}</span></div>
                        <div className="text-xs text-slate-500">
                          {u.totp_confirmed_at ? `Authenticator set up ${datet(u.totp_confirmed_at)}` : 'No authenticator set up'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Pill tone="secondary">{u.role}</Pill>
                        <button
                          type="button"
                          disabled={busy || !u.totp_confirmed_at}
                          onClick={() => reset(u)}
                          title={u.totp_confirmed_at ? 'Reset authenticator' : 'Nothing to reset'}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </GlassCard>
        </>
      )}
    </div>
  )
}
