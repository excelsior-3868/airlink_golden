import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Package, Router } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal, Spinner } from '../components/ui'

const blank = { name: '', type: 'pppoe', plan_type: 'data', bandwidth_id: '', data_gb: '', time_limit: '', validity_days: 1, base_price: 0, selling_price: 0, status: 'active' }

export default function PppoePlans() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(blank)
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'my' | 'admin' | 'seller'>('my')

  const { data: plans = [], loading: plansLoading, refetch: refetchPlans } = useQuery<any[]>('plans?type=pppoe', () => api.get('/plans?type=pppoe').then((r) => r.data.data))
  const { data: bandwidths = [] } = useQuery<any[]>('bandwidths', () => api.get('/bandwidths').then((r) => r.data.data))

  // Refresh this page's plans and drop other cached plan lists after a change.
  const load = () => { refetchPlans(); invalidateCache('plans'); invalidateCache('reports/plans') }

  const openNew = () => {
    setForm({ ...blank, bandwidth_id: bandwidths[0]?.id || '' })
    setEditId(null)
    setErr('')
    setOpen(true)
  }

  const openEdit = (p: any) => {
    setForm({
      ...p,
      bandwidth_id: p.bandwidth_id ?? '',
      data_gb: p.data_gb ?? '',
      time_limit: p.time_limit ?? ''
    })
    setEditId(p.id)
    setErr('')
    setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const payload = {
        ...form,
        type: 'pppoe',
        bandwidth_id: form.bandwidth_id || null,
        data_gb: form.data_gb || null,
        time_limit: form.time_limit || null
      }
      if (editId) {
        await api.put(`/plans/${editId}`, payload)
      } else {
        await api.post('/plans', payload)
      }
      setOpen(false)
      load()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; plan: any }>({ open: false, plan: null })

  const del = (p: any) => {
    setConfirmDelete({ open: true, plan: p })
  }

  const filteredPlans = plans.filter((p) => {
    if (user?.role !== 'reseller') return true
    if (activeTab === 'my') return p.created_by === user.id
    if (activeTab === 'admin') return p.created_by === null || p.creator?.role === 'admin'
    if (activeTab === 'seller') return p.created_by !== null && p.created_by !== user.id && p.creator?.role === 'seller'
    return true
  })

  return (
    <div>
      <PageTitle
        title="PPPOE Plans"
        subtitle="Broadband connection packages"
        icon={<Router size={22} className="text-indigo-500" />}
        action={
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="btn-primary flex items-center gap-2"
            onClick={openNew}
          >
            <Plus size={16} /> New Plan
          </motion.button>
        }
      />

      {user?.role === 'reseller' && (
        <div className="flex border-b border-slate-200/80 mb-6 gap-2">
          <button
            onClick={() => setActiveTab('my')}
            className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all ${
              activeTab === 'my'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            My Plans
          </button>
          <button
            onClick={() => setActiveTab('admin')}
            className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all ${
              activeTab === 'admin'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Plan Created from Admin
          </button>
          <button
            onClick={() => setActiveTab('seller')}
            className={`pb-3 px-4 text-sm font-bold border-b-2 transition-all ${
              activeTab === 'seller'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Seller Plan
          </button>
        </div>
      )}

      <GlassCard className="!p-0 overflow-hidden">
        {plansLoading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Bandwidth</th>
                  <th>Data</th>
                  <th>Validity</th>
                  <th>Price</th>
                  {user?.role === 'reseller' && activeTab === 'seller' && (
                    <>
                      <th>Created By</th>
                      <th>Seller GB Balance</th>
                    </>
                  )}
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredPlans.map((p, idx) => (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="hover:bg-secondary/30 transition-all"
                  >
                    <td className="font-semibold">{p.name}</td>
                    <td className="capitalize">{p.plan_type}</td>
                    <td>{p.bandwidth || '—'}</td>
                    <td>{p.data_gb ? gb(p.data_gb) : '—'}</td>
                    <td>{p.validity_days}d</td>
                    <td>{rs(p.selling_price)}</td>
                    {user?.role === 'reseller' && activeTab === 'seller' && (
                      <>
                        <td className="font-medium text-slate-600">
                          {p.creator ? `${p.creator.name} (${p.creator.username})` : '—'}
                        </td>
                        <td className="font-medium text-cyan-600">
                          {p.creator ? gb(p.creator.gb_balance) : '—'}
                        </td>
                      </>
                    )}
                    <td>
                      <Pill tone={p.status === 'active' ? 'success' : 'secondary'}>{p.status}</Pill>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {(isAdmin || p.created_by === user?.id) && (
                        <>
                          <button className="text-xs font-bold text-primary hover:underline mr-3" onClick={() => openEdit(p)}>
                            Edit
                          </button>
                          <button className="text-xs font-bold text-rose-500 hover:underline" onClick={() => del(p)}>
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {filteredPlans.length === 0 && <EmptyState>No PPPOE plans yet.</EmptyState>}
          </div>
        )}
      </GlassCard>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit PPPOE Plan' : 'New PPPOE Plan'}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Plan name</label>
            <input
              className="input"
              placeholder="e.g. PPPOE 10Mbps Unlimited"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Quota Type</label>
              <select
                className="input"
                value={form.plan_type}
                onChange={(e) => setForm({ ...form, plan_type: e.target.value })}
              >
                <option value="data">Data</option>
                <option value="time">Time</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Bandwidth Limit</label>
              <select
                className="input"
                value={form.bandwidth_id}
                onChange={(e) => setForm({ ...form, bandwidth_id: e.target.value })}
              >
                <option value="">— Select Bandwidth —</option>
                {bandwidths.map((bw) => (
                  <option key={bw.id} value={bw.id}>
                    {bw.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Data GB</label>
              <input
                className="input"
                type="number"
                placeholder="Data GB"
                value={form.data_gb}
                disabled={form.plan_type === 'time' || form.plan_type === 'unlimited'}
                onChange={(e) => setForm({ ...form, data_gb: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Time Limit (min)</label>
              <input
                className="input"
                type="number"
                placeholder="Time limit (min)"
                value={form.time_limit}
                disabled={form.plan_type === 'data' || form.plan_type === 'unlimited'}
                onChange={(e) => setForm({ ...form, time_limit: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Validity Days</label>
              <input
                className="input"
                type="number"
                placeholder="Validity days"
                value={form.validity_days}
                onChange={(e) => setForm({ ...form, validity_days: +e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Status</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Base Price</label>
              <input
                className="input"
                type="number"
                placeholder="Base price"
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: +e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Selling Price</label>
              <input
                className="input"
                type="number"
                placeholder="Selling price"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: +e.target.value })}
              />
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
              {busy ? 'Saving…' : 'Save Plan'}
            </motion.button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, plan: null })}
        onConfirm={async () => {
          if (!confirmDelete.plan) return
          try {
            await api.delete(`/plans/${confirmDelete.plan.id}`)
            load()
          } catch (e: any) {
            setErr(apiError(e))
          }
        }}
        title="Delete PPPOE Plan"
        message={`Are you sure you want to delete PPPOE plan "${confirmDelete.plan?.name}"?`}
        confirmText="Delete Plan"
      />
    </div>
  )
}
