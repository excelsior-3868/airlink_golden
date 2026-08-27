import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Plus, Package, Pencil, Trash2, Router, RotateCcw, Search, Shield, Zap, Lock } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, statusPill } from '../lib/format'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal, Spinner, CustomSelect, Combobox, Pagination, SelectOption } from '../components/ui'

const PER_PAGE = 15

const blank = {
  name: '',
  type: 'pppoe',
  plan_type: 'unlimited',
  bandwidth_id: '',
  validity_days: 30,
  simultaneous_use: 1,
  base_price: 0,
  selling_price: 0,
  status: 'active',
  owner_id: '',
  nas_device_id: '',
  mac_bind: false,
}

export default function PppoePlans() {
  const { user, can } = useAuth()
  const isAdmin = user?.role === 'admin'
  // PPPoE plans are defined by whoever holds create_pppoe_plan (admin only by
  // default) — every other role sees this page read-only.
  const canManage = can('create_pppoe_plan')
  const isReseller = user?.role === 'reseller'

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(blank)
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'my' | 'admin' | 'all'>('my')
  const [modalTab, setModalTab] = useState<'identity' | 'service' | 'access'>('identity')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [page, setPage] = useState(1)

  const { data: plans = [], loading: plansLoading, refetch: refetchPlans } = useQuery<any[]>('plans?type=pppoe', () =>
    api.get('/plans?type=pppoe').then((r) => r.data.data)
  )
  const { data: bandwidths = [] } = useQuery<any[]>('bandwidths', () =>
    api.get('/bandwidths').then((r) => r.data.data)
  )
  const { data: allNas = [] } = useQuery<any[]>('nas', () =>
    api.get('/nas').then((r) => r.data.data)
  )
  const { data: resellersRes } = useQuery<any>('users?role=reseller&per_page=200', () =>
    isAdmin ? api.get('/users?role=reseller&per_page=200').then((r) => r.data.data.data) : Promise.resolve([])
  )
  const allResellers = useMemo(() => resellersRes || [], [resellersRes])

  const load = () => {
    refetchPlans()
    invalidateCache('plans')
  }

  const bandwidthOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: '', label: '— No Bandwidth Limit (Unlimited) —' }]
    bandwidths.forEach((b: any) => {
      opts.push({
        value: String(b.id),
        label: `${b.name} (${b.rate_down}${b.rate_down_unit}/${b.rate_up}${b.rate_up_unit})`,
      })
    })
    return opts
  }, [bandwidths])

  const nasOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: '', label: '— No Restriction (All Routers) —' }]
    allNas.forEach((n: any) => {
      opts.push({ value: String(n.id), label: `${n.name} (${n.nasname})` })
    })
    return opts
  }, [allNas])

  const ownerOptions = useMemo(() => {
    const opts: SelectOption[] = [
      { value: '', label: 'System Admin (Global Plan)' }
    ]
    allResellers.forEach((r: any) => {
      opts.push({
        value: String(r.id),
        label: r.name,
        badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
      })
    })
    return opts
  }, [allResellers])

  const filterOwnerOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All Owners' }]
    opts.push({ value: 'admin', label: 'Admin Plans Only' })
    if (isAdmin) {
      allResellers.forEach((r: any) => {
        opts.push({ value: `reseller-${r.id}`, label: `Reseller: ${r.name}` })
      })
    }
    return opts
  }, [allResellers, isAdmin])

  const statusOptions: SelectOption[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'active', label: 'Active Plans' },
    { value: 'disabled', label: 'Disabled Plans' },
  ]

  const openNew = () => {
    setForm({
      ...blank,
      bandwidth_id: bandwidths[0]?.id ? String(bandwidths[0].id) : '',
      owner_id: isReseller ? String(user?.id) : '',
    })
    setEditId(null)
    setErr('')
    setModalTab('identity')
    setOpen(true)
  }

  const openEdit = (p: any) => {
    setForm({
      name: p.name,
      type: 'pppoe',
      plan_type: 'unlimited',
      bandwidth_id: p.bandwidth_id ? String(p.bandwidth_id) : '',
      validity_days: p.validity_days || 30,
      simultaneous_use: p.simultaneous_use || 1,
      base_price: p.base_price || 0,
      selling_price: p.selling_price || 0,
      status: p.status || 'active',
      owner_id: p.created_by ? String(p.created_by) : '',
      nas_device_id: p.nas_device_id ? String(p.nas_device_id) : '',
      mac_bind: Boolean(p.mac_bind),
    })
    setEditId(p.id)
    setErr('')
    setModalTab('identity')
    setOpen(true)
  }

  const save = async () => {
    setErr('')
    if (!form.name.trim()) {
      setErr('Plan Name is required.')
      return
    }
    if (Number(form.validity_days) < 1) {
      setErr('Validity Days must be at least 1 day.')
      return
    }
    if (Number(form.selling_price) < 0) {
      setErr('Selling Price cannot be negative.')
      return
    }
    if (Number(form.simultaneous_use) < 1 || Number(form.simultaneous_use) > 10) {
      setErr('Simultaneous Use must be between 1 and 10 devices.')
      return
    }

    setBusy(true)
    try {
      const payload: any = {
        name: form.name.trim(),
        type: 'pppoe',
        plan_type: 'unlimited',
        bandwidth_id: form.bandwidth_id ? Number(form.bandwidth_id) : null,
        validity_days: Number(form.validity_days),
        simultaneous_use: Number(form.simultaneous_use),
        selling_price: Number(form.selling_price),
        base_price: Number(form.base_price || 0),
        status: form.status,
        nas_device_id: form.nas_device_id ? Number(form.nas_device_id) : null,
        mac_bind: Boolean(form.mac_bind),
      }
      if (isAdmin && form.owner_id) {
        payload.owner_id = Number(form.owner_id)
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

  const handleDelete = async () => {
    if (!confirmDelete.plan) return
    setBusy(true)
    try {
      await api.delete(`/plans/${confirmDelete.plan.id}`)
      setConfirmDelete({ open: false, plan: null })
      load()
    } catch (e) {
      alert(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  // Filter plans
  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      // Role scope tab
      if (isReseller) {
        if (activeTab === 'my' && p.created_by !== user?.id) return false
        if (activeTab === 'admin' && p.created_by !== null && p.creator?.role !== 'admin') return false
      }

      // Search
      if (search) {
        const q = search.toLowerCase()
        const matchName = p.name.toLowerCase().includes(q)
        const matchBw = (p.bandwidth || '').toLowerCase().includes(q)
        const matchCreator = (p.creator?.name || '').toLowerCase().includes(q)
        if (!matchName && !matchBw && !matchCreator) return false
      }

      // Status
      if (statusFilter !== 'all' && p.status !== statusFilter) return false

      // Owner filter (Admin)
      if (ownerFilter !== 'all') {
        if (ownerFilter === 'admin' && p.created_by !== null && p.creator?.role !== 'admin') return false
        if (ownerFilter.startsWith('reseller-')) {
          const resId = +ownerFilter.split('-')[1]
          if (p.created_by !== resId) return false
        }
      }

      return true
    })
  }, [plans, isReseller, activeTab, user, search, statusFilter, ownerFilter])

  const totalPages = Math.ceil(filteredPlans.length / PER_PAGE)
  const paginatedPlans = useMemo(() => {
    const start = (page - 1) * PER_PAGE
    return filteredPlans.slice(start, start + PER_PAGE)
  }, [filteredPlans, page])

  const totalActive = useMemo(() => plans.filter((p) => p.status === 'active').length, [plans])
  const totalDisabled = useMemo(() => plans.filter((p) => p.status === 'disabled').length, [plans])

  return (
    <div className="space-y-6">
      <PageTitle
        title="PPPoE Plans"
        subtitle="Manage dedicated PPPoE broadband internet subscription packages"
        icon={<Router size={22} className="text-indigo-500" />}
        action={
          canManage ? (
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center gap-2"
              onClick={openNew}
            >
              <Plus size={16} /> Create Plan
            </motion.button>
          ) : undefined
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <GlassCard className="p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <Package size={20} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Total PPPoE Plans</div>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">{plans.length}</div>
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Zap size={20} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Active Plans</div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{totalActive}</div>
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <Lock size={20} />
          </div>
          <div>
            <div className="text-xs text-slate-500 font-medium">Disabled Plans</div>
            <div className="text-xl font-bold text-rose-600 dark:text-rose-400 mt-0.5">{totalDisabled}</div>
          </div>
        </GlassCard>
      </div>

      {/* Filter Bar */}
      <GlassCard className="p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="relative w-full md:w-80">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search plan name, speed, owner..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="w-full pl-9 pr-3.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {isReseller && (
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => { setActiveTab('my'); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${activeTab === 'my' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500'}`}
                >
                  My Plans
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('admin'); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${activeTab === 'admin' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500'}`}
                >
                  Admin Plans
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveTab('all'); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${activeTab === 'all' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500'}`}
                >
                  All Plans
                </button>
              </div>
            )}

            <div className="w-40">
              <CustomSelect
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); setPage(1) }}
                options={statusOptions}
              />
            </div>

            {isAdmin && (
              <div className="w-52">
                <CustomSelect
                  value={ownerFilter}
                  onChange={(v) => { setOwnerFilter(v); setPage(1) }}
                  options={filterOwnerOptions}
                />
              </div>
            )}

            {(search || statusFilter !== 'all' || ownerFilter !== 'all' || (isReseller && activeTab !== 'my')) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                  setOwnerFilter('all')
                  setActiveTab('my')
                  setPage(1)
                }}
                className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
                title="Reset Filters"
              >
                <RotateCcw size={16} />
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Plans Table */}
      <GlassCard className="overflow-hidden">
        {plansLoading ? (
          <Spinner />
        ) : paginatedPlans.length === 0 ? (
          <EmptyState
            title="No PPPoE Plans Found"
            subtitle={
              canManage
                ? 'No plans match your selected criteria or search term. Click Create Plan to build one.'
                : 'No plans match your selected criteria or search term. PPPoE plans are defined by the system administrator.'
            }
          >
            {canManage && (
              <div className="pt-4">
                <button onClick={openNew} className="btn-primary inline-flex items-center gap-2">
                  <Plus size={16} /> Create Plan
                </button>
              </div>
            )}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase font-semibold tracking-wider">
                  <th className="py-3 px-4">Plan Name & Details</th>
                  <th className="py-3 px-4">Bandwidth Speed</th>
                  <th className="py-3 px-4">Validity Days</th>
                  <th className="py-3 px-4">Selling Price</th>
                  <th className="py-3 px-4">Multi-Device / MAC</th>
                  <th className="py-3 px-4">NAS Restriction</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedPlans.map((p) => {
                  // A grantee may edit any PPPoE plan; the wallet-ownership
                  // clause that would otherwise stop a non-admin is bypassed
                  // for PPPoE plans server-side (PlanController::update).
                  const canEdit = canManage
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">{p.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span>Owner: {p.creator?.name || 'System Admin'}</span>
                          {p.creator?.role === 'reseller' && (
                            <span className="text-[9px] bg-purple-50 text-purple-600 font-bold px-1.5 py-0.2 rounded-full border border-purple-100">Reseller</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {p.bandwidth || 'Unlimited Speed'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {p.validity_days} Days
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-slate-900 dark:text-white">
                          {rs(p.selling_price)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <div className="text-slate-700 dark:text-slate-300">
                            {p.simultaneous_use || 1} Device{p.simultaneous_use > 1 ? 's' : ''}
                          </div>
                          {p.mac_bind ? (
                            <span className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium border border-amber-200/50">
                              MAC Locked
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">No MAC Lock</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-slate-600 dark:text-slate-400">
                          {p.nas_device?.name || 'All Routers'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Pill tone={(statusPill[p.status] as any) || 'info'} className="capitalize">
                          {p.status}
                        </Pill>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canEdit ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                              title="Edit Plan"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete({ open: true, plan: p })}
                              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                              title="Delete Plan"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Read Only</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <Pagination
              meta={{
                current_page: page,
                last_page: totalPages,
                total: filteredPlans.length,
                per_page: PER_PAGE,
              }}
              onPage={setPage}
            />
          </div>
        )}
      </GlassCard>

      {/* Plan Form Modal (3-Tab Architecture) */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? 'Edit PPPoE Plan' : 'Create PPPoE Plan'}
        widthClassName="max-w-xl"
      >
        <div className="space-y-4">
          {/* Tab Headers */}
          <div className="flex items-center border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setModalTab('identity')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'identity' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Identity & Owner
            </button>
            <button
              type="button"
              onClick={() => setModalTab('service')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'service' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Service & Pricing
            </button>
            <button
              type="button"
              onClick={() => setModalTab('access')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'access' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Access & Security
            </button>
          </div>

          {/* Identity Tab */}
          {modalTab === 'identity' && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                  Plan Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 50 Mbps Unlimited Monthly"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                  Status
                </label>
                <CustomSelect
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v })}
                  options={[
                    { value: 'active', label: 'Active (Available for Recharge)' },
                    { value: 'disabled', label: 'Disabled (Archived)' },
                  ]}
                />
              </div>

              {isAdmin && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Plan Owner / Reseller
                  </label>
                  <CustomSelect
                    value={form.owner_id}
                    onChange={(v) => setForm({ ...form, owner_id: v })}
                    options={ownerOptions}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    System Admin plans can be used globally across all resellers.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Service Tab */}
          {modalTab === 'service' && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                  Bandwidth Speed Limit
                </label>
                <CustomSelect
                  value={form.bandwidth_id}
                  onChange={(v) => setForm({ ...form, bandwidth_id: v })}
                  options={bandwidthOptions}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Selling Price (NPR) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={form.selling_price}
                    onChange={(e) => setForm({ ...form, selling_price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Validity Duration (Days) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.validity_days}
                    onChange={(e) => setForm({ ...form, validity_days: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Access Tab */}
          {modalTab === 'access' && (
            <div className="space-y-3.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Simultaneous Connections
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={form.simultaneous_use}
                    onChange={(e) => setForm({ ...form, simultaneous_use: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Default is 1 session per PPPoE subscriber.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Router / NAS Restriction
                  </label>
                  <CustomSelect
                    value={form.nas_device_id}
                    onChange={(v) => setForm({ ...form, nas_device_id: v })}
                    options={nasOptions}
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.mac_bind}
                    onChange={(e) => setForm({ ...form, mac_bind: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Enable Automatic MAC Address Binding on First Login
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 mt-1 ml-6.5">
                  When enabled, the subscriber is locked to their first connecting router MAC address.
                </p>
              </div>
            </div>
          )}

          {/* Error display */}
          {err && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">
              {err}
            </div>
          )}

          {/* Modal Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Shield size={13} />
              <span>FreeRADIUS Synchronized</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm hover:shadow transition disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
                <span>{editId ? 'Save Changes' : 'Create Plan'}</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, plan: null })}
        onConfirm={handleDelete}
        title="Delete PPPoE Plan"
        message={`Are you sure you want to permanently delete plan "${confirmDelete.plan?.name}"? This action cannot be undone.`}
        confirmText="Delete Plan"
      />
    </div>
  )
}
