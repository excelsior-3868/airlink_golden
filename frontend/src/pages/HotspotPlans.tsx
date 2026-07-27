import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Plus, Package, Pencil, Trash2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal, Spinner, CustomSelect, SelectOption } from '../components/ui'

const blank = { name: '', type: 'hotspot', package_type: 'wallet', plan_type: 'unlimited', bandwidth_id: '', data_gb: '', validity_days: 1, base_price: 0, selling_price: 0, status: 'active', delegation_id: '' }

export default function HotspotPlans() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(blank)
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'my' | 'admin' | 'seller'>('my')

  const { data: plans = [], loading: plansLoading, refetch: refetchPlans } = useQuery<any[]>('plans?type=hotspot', () => api.get('/plans?type=hotspot').then((r) => r.data.data))
  const { data: bandwidths = [] } = useQuery<any[]>('bandwidths', () => api.get('/bandwidths').then((r) => r.data.data))

  // Users lists for delegation when creating a GB Package on behalf of a reseller or seller
  const [allResellers, setAllResellers] = useState<any[]>([])
  const [allSellers, setAllSellers] = useState<any[]>([])

  useEffect(() => {
    if (!user) return
    if (user.role === 'admin') {
      api.get('/users', { params: { role: 'reseller', per_page: 100 } }).then((r) => setAllResellers(r.data.data.data))
      api.get('/users', { params: { role: 'seller', per_page: 500 } }).then((r) => setAllSellers(r.data.data.data))
    } else if (user.role === 'reseller') {
      setAllResellers([])
      api.get('/users', { params: { role: 'seller', per_page: 100 } }).then((r) => setAllSellers(r.data.data.data))
    }
  }, [user])

  const canDelegate = user?.role === 'admin' || user?.role === 'reseller'

  const delegationOptions = useMemo(() => {
    const opts: SelectOption[] = []
    if (user?.role === 'admin' || user?.role === 'reseller') {
      allResellers.filter((r) => r.id !== user?.id).forEach((r) => {
        opts.push({
          value: `reseller-${r.id}`,
          label: r.name,
          badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
        })
      })
    }
    allSellers.forEach((s) => {
      opts.push({
        value: `seller-${s.id}`,
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers, user])

  const [ownerFilter, setOwnerFilter] = useState('all')

  const filterOwnerOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All Packages (Default View)' }]
    if (isAdmin) {
      opts.push({ value: 'admin', label: 'Admin Default Packages' })
    }
    allResellers.filter((r) => r.id !== user?.id).forEach((r) => {
      opts.push({
        value: `reseller-${r.id}`,
        label: r.name,
        badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
      })
    })
    allSellers.forEach((s) => {
      opts.push({
        value: `seller-${s.id}`,
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers, user, isAdmin])

  // Refresh this page's plans and drop other cached plan lists after a change.
  const load = () => { refetchPlans(); invalidateCache('plans'); invalidateCache('reports/plans') }

  const openNew = () => {
    const defaultPackageType = isAdmin ? 'wallet' : 'gb'
    setForm({
      ...blank,
      bandwidth_id: bandwidths[0]?.id || '',
      package_type: defaultPackageType,
      plan_type: defaultPackageType === 'wallet' ? 'unlimited' : 'data',
      base_price: 0,
      selling_price: 0,
      delegation_id: defaultPackageType === 'gb' ? (delegationOptions[0]?.value || '') : ''
    })
    setEditId(null)
    setErr('')
    setOpen(true)
  }

  const openEdit = (p: any) => {
    const pkgType = p.package_type || (isAdmin ? 'wallet' : 'gb')
    let delId = ''
    if (p.creator && p.creator.id !== user?.id && p.creator.role) {
      delId = `${p.creator.role}-${p.creator.id}`
    }
    setForm({
      ...p,
      bandwidth_id: p.bandwidth_id ?? '',
      data_gb: p.data_gb ?? '',
      package_type: pkgType,
      plan_type: p.plan_type === 'time' ? 'unlimited' : (p.plan_type || (pkgType === 'wallet' ? 'unlimited' : 'data')),
      base_price: p.base_price ?? 0,
      selling_price: p.selling_price ?? 0,
      delegation_id: delId
    })
    setEditId(p.id)
    setErr('')
    setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const pkgType = isAdmin ? (form.package_type || 'wallet') : 'gb'
      const quotaType = pkgType === 'wallet' ? 'unlimited' : 'data'

      if (pkgType === 'gb' && (!form.data_gb || +form.data_gb <= 0)) {
        setErr('Please enter a valid Data GB amount greater than 0 for a GB Package.')
        setBusy(false)
        return
      }

      const payload: any = {
        ...form,
        type: 'hotspot',
        package_type: pkgType,
        plan_type: quotaType,
        bandwidth_id: form.bandwidth_id || null,
        data_gb: quotaType === 'data' ? +form.data_gb || null : null,
        base_price: +form.base_price || 0,
        selling_price: +form.selling_price || 0
      }
      delete payload.time_limit
      delete payload.delegation_id

      if (pkgType === 'gb') {
        const delId = form.delegation_id || (delegationOptions[0]?.value || '')
        if (delId.startsWith('seller-')) {
          payload.owner_id = +delId.replace('seller-', '')
        } else if (delId.startsWith('reseller-')) {
          payload.owner_id = +delId.replace('reseller-', '')
        }
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
    if (user?.role === 'seller' && p.package_type === 'wallet') return false
    if (user?.role === 'reseller') {
      if (activeTab === 'my' && p.created_by !== user.id) return false
      if (activeTab === 'admin' && (p.created_by !== null && p.creator?.role !== 'admin')) return false
      if (activeTab === 'seller' && (p.created_by === null || p.created_by === user.id || p.creator?.role !== 'seller')) return false
    }
    if (ownerFilter === 'admin') {
      if (p.created_by && p.creator?.role !== 'admin') return false
    } else if (ownerFilter !== 'all') {
      const idStr = ownerFilter.split('-')[1]
      if (p.created_by !== +idStr) return false
    }
    return true
  })

  return (
    <div>
      <PageTitle
        title="Hotspot Plans"
        subtitle="Voucher-based hotspot packages"
        icon={<Package size={22} className="text-indigo-500" />}
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

      {canDelegate && (
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/60">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
            <span className="text-sm font-bold text-slate-700 whitespace-nowrap">Show Packages For:</span>
            <div className="w-full sm:w-[540px]">
              <CustomSelect
                value={ownerFilter}
                onChange={(val) => setOwnerFilter(val)}
                options={filterOwnerOptions}
                searchable={true}
              />
            </div>
          </div>
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
                  <th>Package Type</th>
                  <th>Package Owner</th>
                  <th>Bandwidth</th>
                  <th>Data</th>
                  <th>Validity</th>
                  <th>Price</th>
                  {user?.role === 'reseller' && activeTab === 'seller' && (
                    <th>Seller GB Balance</th>
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
                    <td>
                      <Pill tone={p.package_type === 'gb' ? 'success' : 'info'}>
                        {p.package_type === 'gb' ? 'GB Package' : 'Wallet Package'}
                      </Pill>
                    </td>
                    <td className="font-medium">
                      {!p.creator || p.creator?.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200/80">
                          Admin (Default)
                        </span>
                      ) : p.creator?.role === 'reseller' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200/80">
                          {p.creator.name}
                          <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-extrabold">Reseller</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/80">
                          {p.creator?.name || 'Seller'}
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-extrabold">Seller</span>
                        </span>
                      )}
                    </td>
                    <td>{p.bandwidth || '—'}</td>
                    <td>{p.data_gb ? gb(p.data_gb) : '—'}</td>
                    <td>{p.validity_days}d</td>
                    <td>{rs(p.selling_price)}</td>
                    {user?.role === 'reseller' && activeTab === 'seller' && (
                      <td className="font-medium text-cyan-600">
                        {p.creator ? gb(p.creator.gb_balance) : '—'}
                      </td>
                    )}
                    <td>
                      <Pill tone={p.status === 'active' ? 'success' : 'secondary'}>{p.status}</Pill>
                    </td>
                    <td className="text-right whitespace-nowrap pr-3">
                      {(isAdmin || (p.package_type !== 'wallet' && p.created_by === user?.id)) && (
                        <>
                          <button className="text-primary hover:text-indigo-700 mr-2 p-1.5 rounded-lg hover:bg-slate-100/80 transition-all inline-flex items-center justify-center" title="Edit" onClick={() => openEdit(p)}>
                            <Pencil size={14} />
                          </button>
                          <button className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50/80 transition-all inline-flex items-center justify-center" title="Delete" onClick={() => del(p)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {filteredPlans.length === 0 && <EmptyState>No Hotspot plans yet.</EmptyState>}
          </div>
        )}
      </GlassCard>

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit Hotspot Plan' : 'New Hotspot Plan'}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">Plan Name</label>
            <input
              className="input"
              placeholder="e.g. 5GB Voucher"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Package Category</label>
              <CustomSelect
                value={form.package_type || (isAdmin ? 'wallet' : 'gb')}
                onChange={(val) => {
                  const newQuota = val === 'wallet' ? 'unlimited' : 'data'
                  const defaultDelegation = val === 'gb' ? (form.delegation_id || delegationOptions[0]?.value || '') : ''
                  setForm({ ...form, package_type: val, plan_type: newQuota, delegation_id: defaultDelegation })
                }}
                disabled={!isAdmin || (editId !== null && !isAdmin)}
                options={[
                  ...(isAdmin ? [{ value: 'wallet', label: 'Wallet Package' }] : []),
                  { value: 'gb', label: 'GB Package' }
                ]}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Quota Type</label>
              <CustomSelect
                value={form.plan_type === 'time' ? 'unlimited' : form.plan_type}
                onChange={(val) => setForm({ ...form, plan_type: val })}
                disabled={true}
                options={
                  (form.package_type || (isAdmin ? 'wallet' : 'gb')) === 'wallet'
                    ? [{ value: 'unlimited', label: 'Unlimited' }]
                    : [{ value: 'data', label: 'Data' }]
                }
              />
            </div>

            {(form.package_type || (isAdmin ? 'wallet' : 'gb')) === 'gb' && canDelegate && (
              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1">On Behalf Of (Reseller/Seller)</label>
                <CustomSelect
                  value={form.delegation_id || delegationOptions[0]?.value || ''}
                  onChange={(val) => setForm({ ...form, delegation_id: val })}
                  options={delegationOptions}
                  className="w-full"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Retail Price (Rs)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 100"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Wholesale Cost (Rs)</label>
              <input
                className="input"
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 80"
                value={form.base_price}
                onChange={(e) => setForm({ ...form, base_price: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Bandwidth Limit</label>
              <CustomSelect
                value={form.bandwidth_id ? String(form.bandwidth_id) : ''}
                onChange={(val) => setForm({ ...form, bandwidth_id: val })}
                options={[
                  { value: '', label: '— Select Bandwidth —' },
                  ...bandwidths.map((bw) => ({
                    value: String(bw.id),
                    label: bw.name
                  }))
                ]}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Validity Days</label>
              <input
                className="input"
                type="number"
                placeholder="Validity days"
                value={form.validity_days}
                onChange={(e) => setForm({ ...form, validity_days: +e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Data GB</label>
              <input
                className="input"
                type="number"
                placeholder="Data GB"
                value={form.data_gb}
                disabled={(form.package_type || (isAdmin ? 'wallet' : 'gb')) === 'wallet' || form.plan_type === 'unlimited'}
                onChange={(e) => setForm({ ...form, data_gb: e.target.value })}
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Status</label>
              <CustomSelect
                value={form.status}
                onChange={(val) => setForm({ ...form, status: val })}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'disabled', label: 'Disabled' }
                ]}
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
          await api.delete(`/plans/${confirmDelete.plan.id}`)
          load()
        }}
        title="Delete Hotspot Plan"
        message={`Are you sure you want to delete hotspot plan "${confirmDelete.plan?.name}"?`}
        confirmText="Delete Plan"
      />
    </div>
  )
}
