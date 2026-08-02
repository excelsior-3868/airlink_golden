import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pencil, Trash2, Search, Package, Gauge } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal, Spinner } from '../components/ui'

const blank = { name: '', rate_down: 1, rate_down_unit: 'Mbps', rate_up: 1, rate_up_unit: 'Mbps' }

export default function Bandwidths() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(blank)
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const { data: bandwidths = [], loading: bwLoading, refetch } = useQuery<any[]>(
    `bandwidths?search=${query}`,
    () => api.get(`/bandwidths?search=${query}`).then((r) => r.data.data),
  )
  // Refetch current view and drop the shared 'bandwidths' list used elsewhere.
  const load = () => { refetch(); invalidateCache('bandwidths') }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(search)
  }

  const openNew = () => {
    setForm(blank)
    setEditId(null)
    setErr('')
    setOpen(true)
  }

  const openEdit = (bw: any) => {
    setForm({
      name: bw.name,
      rate_down: bw.rate_down,
      rate_down_unit: bw.rate_down_unit,
      rate_up: bw.rate_up,
      rate_up_unit: bw.rate_up_unit,
    })
    setEditId(bw.id)
    setErr('')
    setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      if (editId) {
        await api.put(`/bandwidths/${editId}`, form)
      } else {
        await api.post('/bandwidths', form)
      }
      setOpen(false)
      load()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const del = async (bw: any) => {
    if (!confirm(`Delete bandwidth profile "${bw.name}"?`)) return
    try {
      await api.delete(`/bandwidths/${bw.id}`)
      load()
    } catch (e) {
      alert(apiError(e))
    }
  }

  return (
    <div>
      <PageTitle
        title="Bandwidth Plans"
        subtitle="Configure download and upload rate limits"
        icon={<Gauge size={22} className="text-violet-500" />}
        action={
          isAdmin && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center gap-1.5"
              onClick={openNew}
            >
              <Plus size={16} /> Add New Bandwidth
            </motion.button>
          )
        }
      />

      <form onSubmit={handleSearchSubmit} className="flex gap-2 mb-4 max-w-md">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-3 flex items-center text-muted-foreground">
            <Search size={16} />
          </span>
          <input
            className="input pl-9"
            placeholder="Search by Name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary px-5">Search</button>
      </form>

      <GlassCard className="!p-0 overflow-hidden">
        {bwLoading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="w-12 text-center">S.N.</th>
                  <th>Bandwidth Name</th>
                  <th>Rate Download</th>
                  <th>Rate Upload</th>
                  {isAdmin && <th className="text-right pr-6 w-24">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {bandwidths.map((b, idx) => (
                  <motion.tr
                    key={b.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="hover:bg-secondary/30 transition-all"
                  >
                    <td className="text-center font-medium text-slate-500">{idx + 1}</td>
                    <td className="font-semibold text-slate-800">{b.name}</td>
                    <td>{b.rate_down} {b.rate_down_unit}</td>
                    <td>{b.rate_up} {b.rate_up_unit}</td>
                      <td className="text-right whitespace-nowrap pr-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          <button className="text-primary hover:text-indigo-700 mr-2 p-1.5 rounded-lg hover:bg-slate-100/80 transition-all inline-flex items-center justify-center" title="Edit" onClick={() => openEdit(b)}>
                            <Pencil size={14} />
                          </button>
                          <button className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50/80 transition-all inline-flex items-center justify-center" title="Delete" onClick={() => del(b)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {bandwidths.length === 0 && <EmptyState>No bandwidth plans found.</EmptyState>}
          </div>
        )}
      </GlassCard>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit Bandwidth Plan' : 'New Bandwidth Plan'}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Bandwidth Name</label>
            <input
              className="input"
              placeholder="e.g. 5Mbps"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Download Rate</label>
              <input
                className="input"
                type="number"
                min="1"
                value={form.rate_down}
                onChange={(e) => setForm({ ...form, rate_down: +e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Download Unit</label>
              <select
                className="input"
                value={form.rate_down_unit}
                onChange={(e) => setForm({ ...form, rate_down_unit: e.target.value })}
              >
                <option value="Kbps">Kbps</option>
                <option value="Mbps">Mbps</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Upload Rate</label>
              <input
                className="input"
                type="number"
                min="1"
                value={form.rate_up}
                onChange={(e) => setForm({ ...form, rate_up: +e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Upload Unit</label>
              <select
                className="input"
                value={form.rate_up_unit}
                onChange={(e) => setForm({ ...form, rate_up_unit: e.target.value })}
              >
                <option value="Kbps">Kbps</option>
                <option value="Mbps">Mbps</option>
              </select>
            </div>
          </div>

          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setOpen(false)}>Cancel</button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md"
              disabled={busy}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save Bandwidth'}
            </motion.button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
