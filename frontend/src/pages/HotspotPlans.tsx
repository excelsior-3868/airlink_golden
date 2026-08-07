import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Plus, Package, Pencil, Trash2, Wifi, RotateCcw } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal, Spinner, CustomSelect, SelectOption } from '../components/ui'

const blank = { name: '', type: 'hotspot', package_type: 'wallet', plan_type: 'unlimited', bandwidth_id: '', data_gb: '', daily_data_gb: '', validity_days: 1, simultaneous_use: 1, base_price: 0, selling_price: 0, status: 'active', delegation_id: '', nas_device_id: '', mac_bind: false }

export default function HotspotPlans() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(blank)
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<'my' | 'admin' | 'seller'>('my')
  const [modalTab, setModalTab] = useState<'basic' | 'quota' | 'access'>('basic')

  const { data: plans = [], loading: plansLoading, refetch: refetchPlans } = useQuery<any[]>('plans?type=hotspot', () => api.get('/plans?type=hotspot').then((r) => r.data.data))
  const { data: bandwidths = [] } = useQuery<any[]>('bandwidths', () => api.get('/bandwidths').then((r) => r.data.data))
  const { data: allNas = [] } = useQuery<any[]>('nas', () => api.get('/nas').then((r) => r.data.data))

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

  // A reseller may keep a GB package for itself instead of handing it to a downline
  // seller — without this the picker only lists sellers and the plan silently lands
  // on the first seller, so it never shows up under the reseller's "My Plans" tab.
  const selfDelegationValue = user?.role === 'reseller' ? `reseller-${user.id}` : ''

  const delegationOptions = useMemo(() => {
    const opts: SelectOption[] = []
    if (user?.role === 'reseller') {
      opts.push({
        value: `reseller-${user.id}`,
        label: `${user.name} (Myself)`,
        badge: <span className="text-[10px] bg-sky-50 text-sky-600 font-bold px-2 py-0.5 rounded-full border border-sky-100/50">You</span>
      })
    }
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

  // Default the "On Behalf Of" picker to the reseller itself, not to whichever
  // seller happens to sort first.
  const defaultDelegationValue = selfDelegationValue || delegationOptions[0]?.value || ''

  // NAS restriction options: GB packages with a delegate chosen narrow to that
  // delegate's own devices; Wallet packages (or GB with no delegate yet) list all.
  const nasOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: '', label: '— No restriction —' }]
    const delId = form.delegation_id as string
    const delegatedOwnerId = delId ? +delId.split('-')[1] : null
    const pool = (form.package_type === 'gb' && delegatedOwnerId)
      ? allNas.filter((n: any) => n.owner_id === delegatedOwnerId)
      : allNas
    pool.forEach((n: any) => opts.push({ value: String(n.id), label: `${n.name} (${n.nasname})` }))
    return opts
  }, [allNas, form.package_type, form.delegation_id])

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

  // List-page filters
  const [typeFilter, setTypeFilter] = useState('all')
  const [nasFilter, setNasFilter] = useState('all')
  const [macFilter, setMacFilter] = useState('all')
  const [bandwidthFilter, setBandwidthFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [validityFilter, setValidityFilter] = useState('all')

  // A reseller's tabs already answer "whose plans am I looking at", so the owner
  // picker is admin-only. Type/NAS/MAC Bind likewise only earn their place on the
  // reseller's admin tab — its plans are the mixed set worth narrowing; My Plans and
  // Seller Plan are not.
  const isReseller = user?.role === 'reseller'
  const showOwnerFilter = canDelegate && !isReseller
  const showPlanAttributeFilters = !isReseller || activeTab === 'admin'
  // The NAS and MAC Bind table columns follow their filters off the My Plans and
  // Seller Plan tabs.
  const showNasMacColumns = showPlanAttributeFilters

  // Hidden filters must not keep filtering silently — reset them on tab change so
  // the row count always matches the controls the reseller can actually see.
  useEffect(() => {
    if (!showOwnerFilter) setOwnerFilter('all')
    if (!showPlanAttributeFilters) {
      setTypeFilter('all')
      setNasFilter('all')
      setMacFilter('all')
    }
  }, [showOwnerFilter, showPlanAttributeFilters])

  const isFiltered = ownerFilter !== 'all' || typeFilter !== 'all' || nasFilter !== 'all' || macFilter !== 'all' || bandwidthFilter !== 'all' || statusFilter !== 'all' || validityFilter !== 'all'

  const clearFilters = () => {
    setOwnerFilter('all')
    setTypeFilter('all')
    setNasFilter('all')
    setMacFilter('all')
    setBandwidthFilter('all')
    setStatusFilter('all')
    setValidityFilter('all')
  }

  const typeFilterOptions: SelectOption[] = [
    { value: 'all', label: 'All Types' },
    { value: 'data', label: 'Data' },
    { value: 'time', label: 'Time' },
    { value: 'unlimited', label: 'Unlimited' },
    { value: 'daily_data', label: 'Daily Data' }
  ]

  const yesNoOptions = (label: string): SelectOption[] => [
    { value: 'all', label: `All (${label})` },
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' }
  ]

  const bandwidthFilterOptions = useMemo<SelectOption[]>(() => [
    { value: 'all', label: 'All Bandwidths' },
    ...bandwidths.map((bw) => ({ value: String(bw.id), label: bw.name }))
  ], [bandwidths])

  const statusFilterOptions: SelectOption[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'disabled', label: 'Disabled' }
  ]

  const validityFilterOptions = useMemo<SelectOption[]>(() => {
    const days = Array.from(new Set(plans.map((p) => p.validity_days))).sort((a, b) => a - b)
    return [{ value: 'all', label: 'All Validity' }, ...days.map((d) => ({ value: String(d), label: `${d}d` }))]
  }, [plans])

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
      delegation_id: defaultPackageType === 'gb' ? defaultDelegationValue : ''
    })
    setEditId(null)
    setErr('')
    setModalTab('basic')
    setOpen(true)
  }

  const openEdit = (p: any) => {
    const pkgType = p.package_type || (isAdmin ? 'wallet' : 'gb')
    let delId = ''
    if (p.creator && p.creator.role) {
      // Keep a reseller's own plan pinned to itself on save instead of letting the
      // empty value fall through to the first seller in the list.
      delId = p.creator.id === user?.id ? selfDelegationValue : `${p.creator.role}-${p.creator.id}`
    }
    setForm({
      ...p,
      bandwidth_id: p.bandwidth_id ?? '',
      data_gb: p.data_gb ?? '',
      daily_data_gb: p.daily_data_gb ?? '',
      simultaneous_use: p.simultaneous_use ?? 1,
      package_type: pkgType,
      plan_type: p.plan_type === 'time' ? 'unlimited' : (p.plan_type || (pkgType === 'wallet' ? 'unlimited' : 'data')),
      base_price: p.base_price ?? 0,
      selling_price: p.selling_price ?? 0,
      delegation_id: delId,
      nas_device_id: p.nas_device_id ?? '',
      mac_bind: !!p.mac_bind
    })
    setEditId(p.id)
    setErr('')
    setModalTab('basic')
    setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const pkgType = isAdmin ? (form.package_type || 'wallet') : 'gb'
      const quotaType = pkgType === 'gb' ? 'data' : (form.plan_type || 'unlimited')

      if (quotaType === 'data' && (!form.data_gb || +form.data_gb <= 0)) {
        setErr('Please enter a valid Data GB amount greater than 0.')
        setBusy(false)
        return
      }
      if (quotaType === 'daily_data' && (!form.daily_data_gb || +form.daily_data_gb <= 0)) {
        setErr('Please enter a valid Daily Data GB amount greater than 0.')
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
        daily_data_gb: quotaType === 'daily_data' ? +form.daily_data_gb || null : null,
        nas_device_id: form.nas_device_id || null,
        mac_bind: !!form.mac_bind,
        simultaneous_use: +form.simultaneous_use || 1,
        base_price: +form.base_price || 0,
        selling_price: +form.selling_price || 0
      }
      delete payload.time_limit
      delete payload.delegation_id

      if (pkgType === 'gb') {
        const delId = form.delegation_id || defaultDelegationValue
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
    if (typeFilter !== 'all' && p.plan_type !== typeFilter) return false
    if (nasFilter === 'yes' && !p.nas_device_id) return false
    if (nasFilter === 'no' && p.nas_device_id) return false
    if (macFilter === 'yes' && !p.mac_bind) return false
    if (macFilter === 'no' && p.mac_bind) return false
    if (bandwidthFilter !== 'all' && String(p.bandwidth_id) !== bandwidthFilter) return false
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (validityFilter !== 'all' && String(p.validity_days) !== validityFilter) return false
    return true
  })

  return (
    <div>
      <PageTitle
        title="Hotspot Plans"
        subtitle="Voucher-based hotspot packages"
        icon={<Wifi size={22} className="text-sky-500" />}
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

      {showOwnerFilter && (
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

      {/* Each control sizes to its own label and wraps to the next line when the row
          runs out of room. A fixed column count forced every select to the same
          track width, which its 180px minimum then overflowed into its neighbour. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 bg-slate-50/70 p-3.5 rounded-xl border border-slate-200/60">
        {showPlanAttributeFilters && (
          <>
            <CustomSelect className="!min-w-0" value={typeFilter} onChange={setTypeFilter} options={typeFilterOptions} />
            <CustomSelect className="!min-w-0" value={nasFilter} onChange={setNasFilter} options={yesNoOptions('NAS')} />
            <CustomSelect className="!min-w-0" value={macFilter} onChange={setMacFilter} options={yesNoOptions('MAC Bind')} />
          </>
        )}
        <CustomSelect className="!min-w-0" value={bandwidthFilter} onChange={setBandwidthFilter} options={bandwidthFilterOptions} />
        <CustomSelect className="!min-w-0" value={statusFilter} onChange={setStatusFilter} options={statusFilterOptions} />
        <CustomSelect className="!min-w-0" value={validityFilter} onChange={setValidityFilter} options={validityFilterOptions} />
        <button
          onClick={clearFilters}
          disabled={!isFiltered}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all h-[38px] whitespace-nowrap ${
            isFiltered
              ? 'bg-rose-50 text-rose-600 border-rose-200/80 hover:bg-rose-100 hover:text-rose-700 shadow-xs cursor-pointer'
              : 'bg-slate-100/60 text-slate-400 border-slate-200/60 cursor-not-allowed opacity-60'
          }`}
          title="Clear Filters"
        >
          <RotateCcw size={14} />
          Clear Filters
        </button>
      </div>

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
                  <th>Package Category</th>
                  <th>Package Owner</th>
                  <th>Bandwidth</th>
                  <th>Data</th>
                  <th>Validity</th>
                  <th>Price</th>
                  {showNasMacColumns && (
                    <>
                      <th>NAS</th>
                      <th>MAC Bind</th>
                    </>
                  )}
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
                    <td>
                      {p.data_gb
                        ? gb(p.data_gb)
                        : (p.plan_type === 'daily_data' && p.daily_data_gb ? `(${gb(p.daily_data_gb)})` : '—')}
                    </td>
                    <td>{p.validity_days}d</td>
                    <td>{rs(p.selling_price)}</td>
                    {showNasMacColumns && (
                      <>
                        <td>{p.nas_device?.name || '—'}</td>
                        <td>
                          <Pill tone={p.mac_bind ? 'success' : 'secondary'}>{p.mac_bind ? 'Enabled' : 'Disabled'}</Pill>
                        </td>
                      </>
                    )}
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

      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit Hotspot Plan' : 'New Hotspot Plan'} icon={<Wifi size={20} />}>
        <div className="space-y-3">
          <div className="flex gap-2 border-b border-slate-200/80 mb-1">
            {(['basic', 'quota', 'access'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setModalTab(tab)}
                className={`pb-2.5 px-3 text-sm font-bold border-b-2 transition-all ${
                  modalTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                {tab === 'basic' ? 'Basic Info' : tab === 'quota' ? 'Quota & Validity' : 'Access Restriction'}
              </button>
            ))}
          </div>

          {modalTab === 'basic' && (
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
            </div>
          )}

          {modalTab === 'quota' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Package Category</label>
                <CustomSelect
                  value={form.package_type || (isAdmin ? 'wallet' : 'gb')}
                  onChange={(val) => {
                    const newQuota = val === 'wallet' ? 'unlimited' : 'data'
                    const defaultDelegation = val === 'gb' ? (form.delegation_id || defaultDelegationValue) : ''
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
                  disabled={(form.package_type || (isAdmin ? 'wallet' : 'gb')) === 'gb'}
                  options={
                    (form.package_type || (isAdmin ? 'wallet' : 'gb')) === 'wallet'
                      ? [{ value: 'unlimited', label: 'Unlimited' }, { value: 'data', label: 'Data' }, { value: 'daily_data', label: 'Daily Data' }]
                      : [{ value: 'data', label: 'Data' }]
                  }
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
                  disabled={form.plan_type !== 'data'}
                  onChange={(e) => setForm({ ...form, data_gb: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Daily Data GB (per day)</label>
                <input
                  className="input"
                  type="number"
                  placeholder="e.g. 2"
                  value={form.daily_data_gb}
                  disabled={form.plan_type !== 'daily_data'}
                  onChange={(e) => setForm({ ...form, daily_data_gb: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Concurrent Sessions</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  placeholder="e.g. 1"
                  value={form.simultaneous_use}
                  onChange={(e) => setForm({ ...form, simultaneous_use: +e.target.value })}
                />
              </div>
            </div>
          )}

          {modalTab === 'access' && (
            <div className="grid grid-cols-2 gap-3">
              {(form.package_type || (isAdmin ? 'wallet' : 'gb')) === 'gb' && canDelegate && (
                <div className="col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1">On Behalf Of (Reseller/Seller)</label>
                  <CustomSelect
                    value={form.delegation_id || defaultDelegationValue}
                    onChange={(val) => setForm({ ...form, delegation_id: val, nas_device_id: '' })}
                    options={delegationOptions}
                    className="w-full"
                  />
                </div>
              )}

              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1">Restrict to NAS Device</label>
                <CustomSelect
                  value={form.nas_device_id ? String(form.nas_device_id) : ''}
                  onChange={(val) => setForm({ ...form, nas_device_id: val })}
                  options={nasOptions}
                  className="w-full"
                  searchable={true}
                />
              </div>

              <div className="col-span-2">
                <label className="text-xs font-bold text-slate-600 block mb-1">Bind to First-Used MAC Address</label>
                <CustomSelect
                  value={form.mac_bind ? '1' : '0'}
                  onChange={(val) => setForm({ ...form, mac_bind: val === '1' })}
                  options={[
                    { value: '0', label: 'Disabled' },
                    { value: '1', label: 'Enabled' }
                  ]}
                  className="w-full"
                />
              </div>
            </div>
          )}

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
