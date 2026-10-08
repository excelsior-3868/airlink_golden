import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Shield, Save, CheckCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { GlassCard, PageTitle, EmptyState } from '../components/ui'
import { useBranding } from '../lib/branding'

export default function Permissions() {
  const pppoeOnly = useBranding().branding.pppoe_only
  // Voucher and GB permissions have no effect when the system is PPPoE only.
  const isHotspotRow = (r: any) => ['Voucher', 'GB Allocation'].includes(r.category) || /voucher|_gb$/.test(String(r.feature || ''))
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () => {
    setLoading(true)
    api.get('/permissions')
      .then((r) => setRows(r.data.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const toggle = (index: number, role: 'admin' | 'reseller' | 'seller') => {
    const updated = [...rows]
    updated[index][role] = !updated[index][role]
    setRows(updated)
  }

  // PPPoE has no seller-facing surface at all — every PPPoE route is wrapped in
  // role:admin,reseller on top of its permission gate, so a seller tick would
  // save and then do nothing. The API strips it too; this only stops the UI
  // offering a toggle that cannot take effect.
  const sellerLocked = (row: any) => String(row.feature || '').includes('pppoe')

  const save = async () => {
    setSaving(true); setErr(''); setMsg('')
    try {
      const payload = rows.map((r) => ({
        id: r.id,
        admin: !!r.admin,
        reseller: !!r.reseller,
        seller: !!r.seller,
      }))
      const { data } = await api.post('/permissions', { permissions: payload })
      setMsg(data.message)
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageTitle 
        title="Permission Matrix Configuration" 
        subtitle="Dynamically toggle feature access permissions for User Roles" 
        icon={<Shield size={22} className="text-rose-600" />}
        action={
          <motion.button 
            whileTap={{ scale: 0.95 }} 
            className="btn-primary flex items-center gap-2" 
            disabled={saving || loading}
            onClick={save}
          >
            <Save size={16} /> {saving ? 'Saving Changes…' : 'Save Config'}
          </motion.button>
        }
      />

      {msg && (
        <div className="mb-4 p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl flex items-center gap-2 text-sm font-semibold">
          <CheckCircle size={16} /> {msg}
        </div>
      )}
      {err && (
        <div className="mb-4 p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-sm font-semibold">
          {err}
        </div>
      )}

      {loading ? (
        <EmptyState>Loading permission matrix settings…</EmptyState>
      ) : (
        <GlassCard className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="w-1/4">Feature</th>
                  <th className="text-center w-1/6">Admin</th>
                  <th className="text-center w-1/6">Reseller</th>
                  <th className="text-center w-1/6">Seller</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={row.id} className={`hover:bg-secondary/30 transition-colors ${pppoeOnly && isHotspotRow(row) ? 'hidden' : ''}`}>
                    <td className="font-semibold text-slate-800 flex items-center gap-2">
                      <Shield size={14} className="text-primary" /> {row.display_name}
                    </td>
                    <td className="text-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        checked={!!row.admin}
                        onChange={() => toggle(idx, 'admin')}
                      />
                    </td>
                    <td className="text-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        checked={!!row.reseller}
                        onChange={() => toggle(idx, 'reseller')}
                      />
                    </td>
                    <td className="text-center">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 text-primary rounded border-slate-300 focus:ring-primary focus:ring-offset-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        checked={!!row.seller && !sellerLocked(row)}
                        disabled={sellerLocked(row)}
                        title={sellerLocked(row) ? 'PPPoE features are unavailable to the seller role.' : undefined}
                        onChange={() => toggle(idx, 'seller')}
                      />
                    </td>
                    <td className="text-xs text-muted-foreground">{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}
    </div>
  )
}
