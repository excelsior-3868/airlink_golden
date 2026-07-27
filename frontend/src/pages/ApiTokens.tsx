import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, KeyRound, Copy, Check, ShieldAlert, UserCog } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal, Spinner, CustomSelect } from '../components/ui'

interface TokenOwner {
  id: number
  name: string
  username: string
  role: string
}

interface ApiToken {
  id: number
  name: string
  abilities: string[]
  last_used_at: string | null
  created_at: string
  owner: TokenOwner | null
}

interface Candidate extends TokenOwner {
  group: string
}

// Named, ability-scoped Sanctum tokens for third-party integrations (e.g. a hotel/lodge PMS like
// Trekkers Inn selling vouchers through this account) — separate from the SPA's own full-access
// login token, and independently revocable. See backend/app/Http/Controllers/Api/IntegrationTokenController.php.
//
// Mapping which reseller/seller a third-party app is bound to is admin-only: only an admin gets
// the "Create for" picker below (see IntegrationTokenController::store's `user_id` handling) —
// everyone else can only ever create a token for themselves.
export default function ApiTokens() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [targetUserId, setTargetUserId] = useState<number | null>(null)
  const [selectedAbilities, setSelectedAbilities] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [revealToken, setRevealToken] = useState<{ name: string; token: string; owner?: TokenOwner } | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ApiToken | null>(null)

  const { data: tokens = [], loading, refetch } = useQuery<ApiToken[]>(
    'api-tokens',
    () => api.get('/api-tokens').then((r) => r.data.data),
  )
  const { data: abilityCatalog = {} } = useQuery<Record<string, string>>(
    'api-token-abilities',
    () => api.get('/api-tokens/abilities').then((r) => r.data.data),
    { staleTime: Infinity },
  )
  const { data: candidates = [] } = useQuery<Candidate[]>(
    'api-token-candidates',
    async () => {
      const [resellers, sellers] = await Promise.all([
        api.get('/users?role=reseller&per_page=200').then((r) => r.data.data.data),
        api.get('/users?role=seller&per_page=200').then((r) => r.data.data.data),
      ])
      return [
        ...resellers.map((u: TokenOwner) => ({ ...u, group: 'Resellers' })),
        ...sellers.map((u: TokenOwner) => ({ ...u, group: 'Sellers' })),
      ]
    },
    { enabled: isAdmin },
  )

  const openNew = () => {
    setName('')
    setTargetUserId(null)
    setSelectedAbilities(Object.keys(abilityCatalog))
    setErr('')
    setOpen(true)
  }

  const toggleAbility = (key: string) => {
    setSelectedAbilities((prev) => (prev.includes(key) ? prev.filter((a) => a !== key) : [...prev, key]))
  }

  const create = async () => {
    if (!name.trim()) {
      setErr('Enter a name for this token (e.g. "Trekkers Inn").')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const { data } = await api.post('/api-tokens', {
        name: name.trim(),
        abilities: selectedAbilities,
        user_id: targetUserId ?? undefined,
      })
      setOpen(false)
      setRevealToken({ name: data.data.name, token: data.data.token, owner: data.data.owner })
      refetch()
      invalidateCache('api-tokens')
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const copyToken = () => {
    if (!revealToken) return
    navigator.clipboard.writeText(revealToken.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const del = async (t: ApiToken) => {
    await api.delete(`/api-tokens/${t.id}`)
    refetch()
    invalidateCache('api-tokens')
  }

  return (
    <div>
      <PageTitle
        title="API Tokens"
        subtitle="Scoped, revocable tokens for third-party integrations"
        icon={<KeyRound size={22} className="text-indigo-500" />}
        action={
          <motion.button whileTap={{ scale: 0.95 }} className="btn-primary flex items-center gap-1.5" onClick={openNew}>
            <Plus size={16} /> New Token
          </motion.button>
        }
      />

      <GlassCard className="!p-0 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  {isAdmin && <th>Bound To</th>}
                  <th>Abilities</th>
                  <th>Last Used</th>
                  <th>Created</th>
                  <th className="text-right pr-6 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t, idx) => (
                  <motion.tr
                    key={t.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="hover:bg-secondary/30 transition-all"
                  >
                    <td className="font-semibold text-slate-800">{t.name}</td>
                    {isAdmin && (
                      <td>
                        {t.owner ? (
                          <span className="text-xs font-semibold text-slate-600">
                            {t.owner.name} <span className="text-slate-400">({t.owner.role})</span>
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    )}
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {t.abilities.includes('*') ? (
                          <Pill tone="secondary">Full access</Pill>
                        ) : (
                          t.abilities.map((a) => (
                            <Pill key={a} tone="secondary" className="text-[10px]">
                              {abilityCatalog[a] ?? a}
                            </Pill>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="text-slate-500">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'Never'}</td>
                    <td className="text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="text-right whitespace-nowrap pr-3">
                      <div className="flex justify-end">
                        <button
                          className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50/80 transition-all inline-flex items-center justify-center"
                          title="Revoke"
                          onClick={() => setConfirmDelete(t)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {tokens.length === 0 && (
              <EmptyState
                title="No API tokens yet"
                subtitle='Create one for each third-party integration (e.g. "Trekkers Inn") so access can be revoked independently.'
              />
            )}
          </div>
        )}
      </GlassCard>

      {/* Create token */}
      <Modal open={open} onClose={() => setOpen(false)} title="New API Token" icon={<KeyRound size={18} />}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Name</label>
            <input
              className="input"
              placeholder='e.g. "Trekkers Inn"'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {isAdmin && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1 flex items-center gap-1.5">
                <UserCog size={12} /> Create For
              </label>
              <CustomSelect
                value={targetUserId ?? ''}
                onChange={(v) => setTargetUserId(v === '' ? null : Number(v))}
                options={[
                  { value: '', label: 'Myself (admin)' },
                  ...candidates.map((c) => ({ value: c.id, label: `${c.name} (${c.username})`, group: c.group })),
                ]}
                className="w-full"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                Binds this token to the selected reseller/seller's own account and voucher stock — only an admin can do this.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-2">Abilities</label>
            <div className="space-y-2">
              {Object.entries(abilityCatalog).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedAbilities.includes(key)}
                    onChange={() => toggleAbility(key)}
                    className="rounded border-slate-300"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Unchecked abilities are permanently denied to this token, even if the account has broader permissions.
            </p>
          </div>

          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md"
              disabled={busy}
              onClick={create}
            >
              {busy ? 'Creating…' : 'Create Token'}
            </motion.button>
          </div>
        </div>
      </Modal>

      {/* Reveal — shown exactly once, right after creation. */}
      <Modal
        open={!!revealToken}
        onClose={() => setRevealToken(null)}
        title="Token Created"
        subtitle={revealToken?.owner ? `Bound to ${revealToken.owner.name} (${revealToken.owner.role})` : revealToken?.name}
        icon={<ShieldAlert size={18} className="text-amber-500" />}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl">
            <ShieldAlert size={14} className="text-amber-500 shrink-0" />
            <span className="text-xs font-semibold text-amber-700">
              Copy this now — it won't be shown again. Paste it into the integration's settings.
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <code className="flex-1 text-xs break-all font-mono text-slate-700">{revealToken?.token}</code>
            <button
              onClick={copyToken}
              className="shrink-0 p-2 rounded-lg hover:bg-white border border-slate-200 transition-all"
              title="Copy"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-slate-500" />}
            </button>
          </div>
          <div className="flex justify-end pt-2">
            <button className="btn-primary py-2 px-6 rounded-2xl font-bold" onClick={() => setRevealToken(null)}>
              Done
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => del(confirmDelete!)}
        title="Revoke API Token"
        message={`Revoke "${confirmDelete?.name}"? Anything using this token will immediately lose access.`}
        confirmText="Revoke"
      />
    </div>
  )
}
