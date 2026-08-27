import { useState, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Users2, Plus, Zap, Pencil, Trash2, PauseCircle, PlayCircle, Unplug,
  Eye, Search, RotateCcw, Download, Router, Shield, Clock,
  AlertTriangle, CheckCircle, Activity
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, date, datet, bsDate, statusPill } from '../lib/format'
import {
  GlassCard, PageTitle, Modal, Pill, EmptyState, ConfirmModal,
  Spinner, CustomSelect, Combobox, Pagination, SelectOption
} from '../components/ui'
import PppoeRechargeModal from '../components/PppoeRechargeModal'

const PER_PAGE = 15

const blankCustomer = {
  username: '',
  password: '',
  full_name: '',
  phone: '',
  address: '',
  plan_id: '',
  contract_price: '',
  periods: 1,
  activate_now: true,
  mac_bind: false,
  mac_address: '',
  nas_device_id: '',
  simultaneous_use: 1,
  owner_id: '',
}

export default function PppoeCustomers() {
  const { user, can } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isReseller = user?.role === 'reseller'

  // Subscriptions Table State
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [resellerFilter, setResellerFilter] = useState('all')
  // Which stat tile is selected. Mirrors the server's `view` param 1:1.
  const [view, setView] = useState<'all' | 'active' | 'expiring_7d' | 'expired_suspended' | 'online'>('all')
  const [page, setPage] = useState(1)

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [modalTab, setModalTab] = useState<'identity' | 'subscription' | 'network'>('identity')
  const [form, setForm] = useState<any>(blankCustomer)
  const [editCustomer, setEditCustomer] = useState<any>(null)

  const [rechargeModalOpen, setRechargeModalOpen] = useState(false)
  const [selectedForRecharge, setSelectedForRecharge] = useState<any>(null)

  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedForDetail, setSelectedForDetail] = useState<any>(null)
  const [detailTab, setDetailTab] = useState<'info' | 'sessions' | 'recharges'>('info')
  const [detailSessions, setDetailSessions] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    type: 'suspend' | 'resume' | 'disconnect' | 'delete'
    customer: any
  }>({ open: false, type: 'suspend', customer: null })

  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Data fetching. /pppoe/customers is server-paginated AND server-filtered, so
  // the filters travel with the request rather than being applied to one page's
  // worth of rows — filtering client-side would only ever search the visible 15.
  const custFilters = () => {
    const p: Record<string, string> = {}
    if (search.trim()) p.q = search.trim()
    if (statusFilter !== 'all') p.status = statusFilter
    if (planFilter !== 'all') p.plan_id = planFilter
    if (isAdmin && resellerFilter !== 'all') p.owner_id = resellerFilter
    if (view !== 'all') p.view = view
    return p
  }
  const custKey = new URLSearchParams(custFilters()).toString()
  const isFiltered = custKey !== ''

  // Selecting a tile and picking a status are two ways to say the same thing,
  // so they clear each other rather than combining into a contradiction like
  // "Active subscribers that are expired".
  const selectView = (v: typeof view) => {
    setView((prev) => (prev === v ? 'all' : v))
    setStatusFilter('all')
    setPage(1)
  }

  // Reset to page 1 at render time (not in an effect) when the filters change,
  // or the first request after a filter change fires against a stale page.
  const lastCustKey = useRef(custKey)
  if (lastCustKey.current !== custKey) {
    lastCustKey.current = custKey
    if (page !== 1) setPage(1)
  }

  const { data: custPage, loading, refetch: refetchCustomers } = useQuery<any>(
    `pppoe/customers?page=${page}&${custKey}`,
    () => api.get('/pppoe/customers', { params: { page, per_page: PER_PAGE, ...custFilters() } }).then((r) => r.data.data)
  )
  const customers: any[] = Array.isArray(custPage?.data) ? custPage.data : []

  const { data: summary = null, refetch: refetchSummary } = useQuery<any>(
    // Deliberately unfiltered: the tiles are whole-estate totals, so they stay
    // put while you click between them instead of collapsing to the selection.
    'pppoe/customers/summary',
    () => api.get('/pppoe/customers/summary').then((r) => r.data.data)
  )

  const { data: plans = [] } = useQuery<any[]>('plans?type=pppoe&active_only=1', () =>
    api.get('/plans?type=pppoe&active_only=1').then((r) => r.data.data)
  )

  const { data: allNas = [] } = useQuery<any[]>('nas', () =>
    api.get('/nas').then((r) => r.data.data)
  )

  const { data: resellersRes } = useQuery<any>('users?role=reseller&per_page=200', () =>
    isAdmin ? api.get('/users?role=reseller&per_page=200').then((r) => r.data.data.data) : Promise.resolve([])
  )
  const allResellers = useMemo(() => resellersRes || [], [resellersRes])

  const loadAll = () => {
    refetchCustomers()
    refetchSummary()
    invalidateCache('pppoe')
  }

  // Filter options
  const planOptions = useMemo(() => {
    return plans.map((p) => ({
      value: String(p.id),
      label: `${p.name} (${p.bandwidth || 'Unlimited'}) - ${rs(p.selling_price)} / ${p.validity_days} Days`,
      badge: <span className="text-[10px] bg-indigo-50 text-indigo-600 font-bold px-2 py-0.5 rounded-full border border-indigo-100/50">{p.validity_days} Days</span>
    }))
  }, [plans])

  const filterPlanOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All Internet Plans' }]
    plans.forEach((p) => opts.push({ value: String(p.id), label: p.name }))
    return opts
  }, [plans])

  const statusOptions: SelectOption[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'active', label: 'Active Subscribers' },
    { value: 'pending', label: 'Pending (Not Activated)' },
    { value: 'expired', label: 'Expired Subscription' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'terminated', label: 'Terminated' },
  ]

  const nasOptions = useMemo(() => {
    // Keyed by device id: the API takes nas_device_id and denormalises nasname
    // into pppoe_customers.nas_ip itself.
    const opts: SelectOption[] = [{ value: '', label: '— No Restriction (Any Router) —' }]
    allNas.forEach((n: any) => opts.push({ value: String(n.id), label: `${n.name} (${n.nasname})` }))
    return opts
  }, [allNas])

  const resellerOptions = useMemo(() => {
    // Resellers only: the empty value stays unlisted and simply means the admin
    // is creating the subscriber for themselves (no delegation).
    const opts: SelectOption[] = []
    allResellers.forEach((r: any) => opts.push({ value: String(r.id), label: r.name }))
    return opts
  }, [allResellers])

  const filterResellerOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All Resellers / Owners' }]
    opts.push({ value: 'admin', label: 'System Admin Direct' })
    allResellers.forEach((r: any) => opts.push({ value: String(r.id), label: `Reseller: ${r.name}` }))
    return opts
  }, [allResellers])

  // Open Create
  const openCreate = () => {
    setForm({
      ...blankCustomer,
      plan_id: plans[0]?.id ? String(plans[0].id) : '',
      owner_id: isReseller ? String(user?.id) : '',
    })
    setModalTab('identity')
    setErr('')
    setCreateModalOpen(true)
  }

  // Open Edit
  const openEdit = (c: any) => {
    setEditCustomer(c)
    setForm({
      username: c.username,
      password: c.password || '',
      full_name: c.full_name || '',
      phone: c.phone || '',
      address: c.address || '',
      plan_id: c.plan_id ? String(c.plan_id) : '',
      contract_price: c.contract_price !== null && c.contract_price !== undefined ? String(c.contract_price) : '',
      mac_bind: Boolean(c.mac_bind),
      mac_address: c.mac_address || '',
      nas_device_id: c.nas_device_id ? String(c.nas_device_id) : '',
      simultaneous_use: c.simultaneous_use || 1,
      owner_id: c.owner_id ? String(c.owner_id) : '',
    })
    setModalTab('identity')
    setErr('')
    setEditModalOpen(true)
  }

  // Handle Save Create
  const handleSaveCreate = async () => {
    setErr('')
    if (!form.username.trim()) {
      setErr('Username is required.')
      return
    }
    if (!form.password.trim()) {
      setErr('Password is required.')
      return
    }
    if (!form.plan_id) {
      setErr('Internet Plan is required.')
      return
    }

    setBusy(true)
    try {
      const payload: any = {
        username: form.username.trim(),
        password: form.password.trim(),
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        plan_id: Number(form.plan_id),
        contract_price: form.contract_price !== '' ? Number(form.contract_price) : null,
        periods: Number(form.periods || 1),
        activate_now: Boolean(form.activate_now),
        mac_bind: Boolean(form.mac_bind),
        mac_address: form.mac_address.trim() || null,
        nas_device_id: form.nas_device_id ? Number(form.nas_device_id) : null,
        simultaneous_use: Number(form.simultaneous_use || 1),
      }
      // Delegation is expressed as owner_id; the service derives reseller_id
      // from the owner's role.
      if (isAdmin && form.owner_id) {
        payload.owner_id = Number(form.owner_id)
      }

      await api.post('/pppoe/customers', payload)
      setCreateModalOpen(false)
      loadAll()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  // Handle Save Edit
  const handleSaveEdit = async () => {
    if (!editCustomer) return
    setErr('')
    if (!form.password.trim()) {
      setErr('Password cannot be empty.')
      return
    }

    setBusy(true)
    try {
      const payload: any = {
        password: form.password.trim(),
        full_name: form.full_name.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        contract_price: form.contract_price !== '' ? Number(form.contract_price) : null,
        mac_bind: Boolean(form.mac_bind),
        mac_address: form.mac_address.trim() || null,
        nas_device_id: form.nas_device_id ? Number(form.nas_device_id) : null,
        simultaneous_use: Number(form.simultaneous_use || 1),
      }

      await api.put(`/pppoe/customers/${editCustomer.id}`, payload)
      setEditModalOpen(false)
      loadAll()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  // Open Detail
  const openDetail = async (c: any) => {
    setSelectedForDetail(c)
    setDetailTab('info')
    setDetailSessions([])
    setDetailModalOpen(true)
    setDetailLoading(true)
    try {
      // The list row carries no recharge history — only show() eager-loads it —
      // so fetch the full record, or the Recharge History tab always reads empty.
      // The sessions endpoint is paginated, so its rows sit one level deeper.
      const [full, res] = await Promise.all([
        api.get(`/pppoe/customers/${c.id}`),
        api.get(`/pppoe/customers/${c.id}/sessions`),
      ])
      if (full.data?.data) setSelectedForDetail(full.data.data)
      const rows = res.data.data?.data
      setDetailSessions(Array.isArray(rows) ? rows : [])
    } catch (e) {
      // ignore
    } finally {
      setDetailLoading(false)
    }
  }

  // Handle Actions (Suspend / Resume / Disconnect / Delete)
  const handleConfirmAction = async () => {
    const { type, customer } = confirmModal
    if (!customer) return
    setBusy(true)
    try {
      if (type === 'suspend') {
        await api.patch(`/pppoe/customers/${customer.id}/suspend`)
      } else if (type === 'resume') {
        await api.patch(`/pppoe/customers/${customer.id}/resume`)
      } else if (type === 'disconnect') {
        await api.post(`/pppoe/customers/${customer.id}/disconnect`)
      } else if (type === 'delete') {
        await api.delete(`/pppoe/customers/${customer.id}`)
      }
      setConfirmModal({ open: false, type: 'suspend', customer: null })
      loadAll()
    } catch (e) {
      alert(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  // Export CSV
  const handleExportCsv = () => {
    window.open('/api/pppoe/customers/export', '_blank')
  }

  // Filtering and paging are both done by the server (see custFilters above),
  // so the rows for this page are exactly what came back.
  const paginatedCustomers = customers
  const totalPages = custPage?.last_page ?? 1

  return (
    <div className="space-y-6">
      <PageTitle
        title="PPPoE Subscribers"
        subtitle="Manage broadband internet subscribers, subscriptions, live sessions, and recharge billing"
        icon={<Router size={22} className="text-indigo-500" />}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-2 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition flex items-center gap-1.5 shadow-sm"
              title="Export Subscribers CSV"
            >
              <Download size={15} />
              <span>Export CSV</span>
            </button>
            {can('create_pppoe_customer') && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="btn-primary flex items-center gap-2"
                onClick={openCreate}
              >
                <Plus size={16} /> New Subscriber
              </motion.button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
          {/* Stat Cards — each one is a filter for the list below. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {([
              { key: 'all',               label: 'Total Subscribers',   value: summary?.total ?? customers.length, icon: <Users2 size={18} />,        tone: 'indigo',  valueClass: 'text-slate-900 dark:text-white' },
              { key: 'active',            label: 'Active',              value: summary?.active ?? 0,               icon: <CheckCircle size={18} />,   tone: 'emerald', valueClass: 'text-emerald-600 dark:text-emerald-400' },
              { key: 'expiring_7d',       label: 'Expiring Soon',       value: summary?.expiring_7d ?? 0,          icon: <Clock size={18} />,         tone: 'amber',   valueClass: 'text-amber-600 dark:text-amber-400' },
              { key: 'expired_suspended', label: 'Expired / Suspended', value: summary?.expired_suspended ?? 0,    icon: <AlertTriangle size={18} />, tone: 'rose',    valueClass: 'text-rose-600 dark:text-rose-400' },
              { key: 'online',            label: 'Online Live',         value: summary?.online ?? 0,               icon: <Activity size={18} />,      tone: 'sky',     valueClass: 'text-sky-600 dark:text-sky-400' },
            ] as const).map((c, i) => {
              const selected = view === c.key
              const iconTone: Record<string, string> = {
                indigo: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400',
                emerald: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400',
                amber: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400',
                rose: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400',
                sky: 'bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400',
              }
              const ring: Record<string, string> = {
                indigo: 'ring-indigo-500/70', emerald: 'ring-emerald-500/70', amber: 'ring-amber-500/70',
                rose: 'ring-rose-500/70', sky: 'ring-sky-500/70',
              }
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => selectView(c.key)}
                  aria-pressed={selected}
                  title={selected ? 'Clear this filter' : `Show only ${c.label}`}
                  className={`text-left rounded-2xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    selected ? `ring-2 ${ring[c.tone]}` : 'hover:-translate-y-0.5'
                  } ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}
                >
                  <GlassCard className="p-3.5 flex items-center gap-3 h-full">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconTone[c.tone]}`}>
                      {c.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-slate-500 font-medium truncate">{c.label}</div>
                      <div className={`text-lg font-bold mt-0.5 ${c.valueClass}`}>{c.value}</div>
                    </div>
                  </GlassCard>
                </button>
              )
            })}
          </div>

          {/* Filter Bar */}
          <GlassCard className="p-4 space-y-3">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
              <div className="relative w-full md:w-80">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search username, name, phone, IP, MAC..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  className="w-full pl-9 pr-3.5 py-2 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 w-full md:w-auto">
                {/* Each select gets its own track and a floor width, so the three
                    read as separate controls instead of one run-on strip. */}
                <div className="w-full sm:w-48 shrink-0">
                  <CustomSelect
                    value={statusFilter}
                    onChange={(v) => { setStatusFilter(v); setView('all'); setPage(1) }}
                    options={statusOptions}
                  />
                </div>

                <div className="w-full sm:w-52 shrink-0">
                  <CustomSelect
                    value={planFilter}
                    onChange={(v) => { setPlanFilter(v); setPage(1) }}
                    options={filterPlanOptions}
                  />
                </div>

                {isAdmin && (
                  <div className="w-full sm:w-56 shrink-0">
                    <CustomSelect
                      value={resellerFilter}
                      onChange={(v) => { setResellerFilter(v); setPage(1) }}
                      options={filterResellerOptions}
                    />
                  </div>
                )}

                {(search || statusFilter !== 'all' || planFilter !== 'all' || resellerFilter !== 'all' || view !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('all')
                      setPlanFilter('all')
                      setResellerFilter('all')
                      setView('all')
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

          {/* Subscribers Table */}
          <GlassCard className="overflow-hidden">
            {loading ? (
              <Spinner />
            ) : paginatedCustomers.length === 0 ? (
              <EmptyState
                title={isFiltered ? 'No Matching Subscribers' : 'No PPPoE Subscribers Yet'}
                subtitle={isFiltered
                  ? 'No subscribers match your search or filter criteria. Try clearing the filters.'
                  : 'Click New Subscriber to onboard your first one.'}
              >
                {!isFiltered && can('create_pppoe_customer') && (
                  <div className="pt-4">
                    <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2">
                      <Plus size={16} /> New Subscriber
                    </button>
                  </div>
                )}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold">
                      <th className="py-3 px-4">Subscriber</th>
                      <th className="py-3 px-4">Internet Plan</th>
                      <th className="py-3 px-4">Subscription Expiry</th>
                      <th className="py-3 px-4">Contract Price</th>
                      <th className="py-3 px-4">IP & MAC Lock</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {paginatedCustomers.map((c) => {
                      const isExpired = c.expires_at && new Date(c.expires_at) < new Date()
                      return (
                        <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <span>{c.username}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                              <span>{c.full_name || 'No Name Provided'}</span>
                              {c.reseller && (
                                <span className="text-[9px] bg-purple-50 text-purple-600 font-bold px-1.5 py-0.2 rounded-full border border-purple-100">
                                  {c.reseller.name}
                                </span>
                              )}
                            </div>
                            {c.phone && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{c.phone}</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800 dark:text-slate-200">{c.plan?.name || '—'}</div>
                            <div className="text-[11px] text-slate-400">{c.plan?.bandwidth || 'Unlimited Speed'}</div>
                          </td>
                          <td className="py-3 px-4">
                            {c.expires_at ? (
                              <div>
                                <div className={`font-semibold ${isExpired ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                  {date(c.expires_at)}
                                </div>
                                <div className="text-[11px] text-slate-400">{bsDate(c.expires_at)}</div>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Not Activated</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {rs(c.contract_price !== null && c.contract_price !== undefined ? c.contract_price : (c.plan?.selling_price || 0))}
                            </div>
                            {c.contract_price !== null && (
                              <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">Custom Rate</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              {c.current_ip && (
                                <div className="font-mono text-slate-700 dark:text-slate-300">{c.current_ip}</div>
                              )}
                              {c.mac_bind ? (
                                <div className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium border border-amber-200/50 truncate max-w-[130px]">
                                  {c.mac_address || 'Lock on First Login'}
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-400">No MAC Lock</div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <Pill tone={(statusPill[c.status] as any) || 'info'} className="capitalize">
                              {c.status}
                            </Pill>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Recharge Button — only rendered when subscriber is expired */}
                              {can('recharge_pppoe_customer') && (c.status === 'expired' || (c.expires_at && new Date(c.expires_at) < new Date())) && (
                                <button
                                  type="button"
                                  onClick={() => { setSelectedForRecharge(c); setRechargeModalOpen(true) }}
                                  className="p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition"
                                  title="Recharge Subscription"
                                >
                                  <Zap size={15} />
                                </button>
                              )}

                              {/* Detail Drawer */}
                              <button
                                type="button"
                                onClick={() => openDetail(c)}
                                className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                                title="View Subscriber Details"
                              >
                                <Eye size={15} />
                              </button>

                              {/* Edit */}
                              {can('create_pppoe_customer') && (
                                <button
                                  type="button"
                                  onClick={() => openEdit(c)}
                                  className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                                  title="Edit Subscriber Profile"
                                >
                                  <Pencil size={15} />
                                </button>
                              )}

                              {/* Suspend / Resume */}
                              {can('suspend_pppoe_customer') && (
                                c.status === 'suspended' ? (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmModal({ open: true, type: 'resume', customer: c })}
                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-lg transition"
                                    title="Resume Subscription"
                                  >
                                    <PlayCircle size={15} />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmModal({ open: true, type: 'suspend', customer: c })}
                                    className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50 rounded-lg transition"
                                    title="Suspend Subscription"
                                  >
                                    <PauseCircle size={15} />
                                  </button>
                                )
                              )}

                              {/* Disconnect Live Session */}
                              {can('suspend_pppoe_customer') && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmModal({ open: true, type: 'disconnect', customer: c })}
                                  className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                                  title="Disconnect Active PPP Session"
                                >
                                  <Unplug size={15} />
                                </button>
                              )}

                              {/* Delete */}
                              {can('delete_pppoe_customer') && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmModal({ open: true, type: 'delete', customer: c })}
                                  className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition"
                                  title="Delete Subscriber"
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
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
                <Pagination meta={custPage} onPage={setPage} />
              </div>
            )}
          </GlassCard>
      </div>

      {/* Create Subscriber Modal (3 Tabs) */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create PPPoE Subscriber"
        widthClassName="max-w-xl"
      >
        <div className="space-y-4">
          <div className="flex items-center border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setModalTab('identity')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'identity' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Account Credentials
            </button>
            <button
              type="button"
              onClick={() => setModalTab('subscription')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'subscription' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Subscription Plan
            </button>
            <button
              type="button"
              onClick={() => setModalTab('network')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'network' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Network & MAC
            </button>
          </div>

          {/* Identity Tab */}
          {modalTab === 'identity' && (
            <div className="space-y-3.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Username / Login ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. john_doe"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    PPPoE Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. secret123"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 98XXXXXXXX"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Physical Address / Location
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ward 4, Pokhara"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              {isAdmin && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    On the Behalf of
                  </label>
                  <CustomSelect
                    value={form.owner_id}
                    onChange={(v) => setForm({ ...form, owner_id: v })}
                    options={resellerOptions}
                    placeholder="Select a reseller (optional)"
                    searchable
                  />
                </div>
              )}
            </div>
          )}

          {/* Subscription Tab */}
          {modalTab === 'subscription' && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  Internet Plan <span className="text-rose-500">*</span>
                </label>
                <Combobox
                  value={form.plan_id}
                  onChange={(v) => setForm({ ...form, plan_id: v })}
                  options={planOptions}
                  placeholder="Select subscription plan..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Contract Price Override (NPR)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Optional (Default: Plan Price)"
                    value={form.contract_price}
                    onChange={(e) => setForm({ ...form, contract_price: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Initial Validity Multiplier
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={form.periods}
                    onChange={(e) => setForm({ ...form, periods: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.activate_now}
                    onChange={(e) => setForm({ ...form, activate_now: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700"
                  />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Activate Immediately & Create First Recharge Record
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 mt-1 ml-6.5">
                  If unchecked, subscriber will be saved in Pending status without wallet deduction.
                </p>
              </div>
            </div>
          )}

          {/* Network Tab */}
          {modalTab === 'network' && (
            <div className="space-y-3.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Router / NAS Restriction
                  </label>
                  <CustomSelect
                    value={form.nas_device_id}
                    onChange={(v) => setForm({ ...form, nas_device_id: v })}
                    options={nasOptions}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Manual MAC Address (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. AA:BB:CC:DD:EE:FF"
                    value={form.mac_address}
                    onChange={(e) => setForm({ ...form, mac_address: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
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
                    Enable Automatic MAC Binding
                  </span>
                </label>
                <p className="text-[11px] text-slate-400 mt-1 ml-6.5">
                  When enabled, FreeRADIUS binds the subscriber's MAC address on first login.
                </p>
              </div>
            </div>
          )}

          {err && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">
              {err}
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Shield size={13} />
              <span>FreeRADIUS Sync Enabled</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCreate}
                disabled={busy}
                className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm hover:shadow transition disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
                <span>Create Subscriber</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit Subscriber Modal */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Edit Subscriber: ${editCustomer?.username}`}
        widthClassName="max-w-xl"
      >
        <div className="space-y-4">
          <div className="flex items-center border-b border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setModalTab('identity')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'identity' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Account Credentials
            </button>
            <button
              type="button"
              onClick={() => setModalTab('subscription')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'subscription' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Contract Pricing
            </button>
            <button
              type="button"
              onClick={() => setModalTab('network')}
              className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${modalTab === 'network' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Network & MAC
            </button>
          </div>

          {modalTab === 'identity' && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  PPPoE Password <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Physical Address
                  </label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {modalTab === 'subscription' && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                  Contract Price Override (NPR)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Leave blank to charge plan selling price"
                  value={form.contract_price}
                  onChange={(e) => setForm({ ...form, contract_price: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 text-xs space-y-1">
                <div className="font-semibold text-slate-700 dark:text-slate-300">To switch the subscriber's base plan:</div>
                <div className="text-slate-500">
                  Perform a recharge and select the new plan. The next billing cycle will automatically adopt the new speed limit.
                </div>
              </div>
            </div>
          )}

          {modalTab === 'network' && (
            <div className="space-y-3.5 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Router / NAS Restriction
                  </label>
                  <CustomSelect
                    value={form.nas_device_id}
                    onChange={(v) => setForm({ ...form, nas_device_id: v })}
                    options={nasOptions}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Bound MAC Address
                  </label>
                  <input
                    type="text"
                    placeholder="Clear to reset MAC lock"
                    value={form.mac_address}
                    onChange={(e) => setForm({ ...form, mac_address: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
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
                    Enable Automatic MAC Binding
                  </span>
                </label>
              </div>
            </div>
          )}

          {err && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">
              {err}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={busy}
              className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm hover:shadow transition disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />}
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Recharge Modal Component */}
      <PppoeRechargeModal
        open={rechargeModalOpen}
        onClose={() => setRechargeModalOpen(false)}
        customer={selectedForRecharge}
        onSuccess={loadAll}
      />

      {/* Subscriber Detail Drawer / Modal */}
      <Modal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={`Subscriber Details: ${selectedForDetail?.username}`}
        widthClassName="max-w-2xl"
      >
        {selectedForDetail && (
          <div className="space-y-4">
            <div className="flex items-center border-b border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setDetailTab('info')}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${detailTab === 'info' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}
              >
                Profile & Service
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('sessions')}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${detailTab === 'sessions' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}
              >
                Session History ({detailSessions.length})
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('recharges')}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${detailTab === 'recharges' ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'}`}
              >
                Recharge History ({selectedForDetail?.recharges?.length || 0})
              </button>
            </div>

            {detailTab === 'info' && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50/80 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <div className="text-slate-400 font-medium">Username</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{selectedForDetail.username}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Cleartext Password</div>
                    <div className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">{selectedForDetail.password || '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Status</div>
                    <div className="mt-0.5">
                      <Pill tone={(statusPill[selectedForDetail.status] as any) || 'info'} className="capitalize">
                        {selectedForDetail.status}
                      </Pill>
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Full Name</div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{selectedForDetail.full_name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Phone</div>
                    <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{selectedForDetail.phone || '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Address</div>
                    <div className="text-slate-800 dark:text-slate-200 mt-0.5 truncate">{selectedForDetail.address || '—'}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50/80 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                  <div>
                    <div className="text-slate-400 font-medium">Plan Name</div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{selectedForDetail.plan?.name || '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Bandwidth Speed</div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{selectedForDetail.plan?.bandwidth || 'Unlimited'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Contract Price</div>
                    <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                      {rs(selectedForDetail.contract_price !== null && selectedForDetail.contract_price !== undefined ? selectedForDetail.contract_price : (selectedForDetail.plan?.selling_price || 0))}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Subscription Expiry</div>
                    <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                      {selectedForDetail.expires_at ? date(selectedForDetail.expires_at) : 'Not Activated'}
                    </div>
                    <div className="text-[10px] text-slate-400">{selectedForDetail.expires_at ? bsDate(selectedForDetail.expires_at) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Static IP Address</div>
                    <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{selectedForDetail.current_ip || 'Not connected'}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 font-medium">Locked MAC Address</div>
                    <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">{selectedForDetail.mac_address || (selectedForDetail.mac_bind ? 'Pending Login' : 'Disabled')}</div>
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'sessions' && (
              <div className="space-y-3">
                {detailLoading ? (
                  <Spinner />
                ) : detailSessions.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    No RADIUS accounting sessions recorded for this subscriber yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 font-semibold">
                          <th className="py-2.5 px-3">Session IP</th>
                          <th className="py-2.5 px-3">Caller MAC</th>
                          <th className="py-2.5 px-3">Start Time</th>
                          <th className="py-2.5 px-3">Stop Time</th>
                          <th className="py-2.5 px-3">Terminate Cause</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {detailSessions.map((s, idx) => (
                          <tr key={s.radacctid || idx} className="hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-mono">{s.framedipaddress || '—'}</td>
                            <td className="py-2 px-3 font-mono">{s.callingstationid || '—'}</td>
                            <td className="py-2 px-3">{datet(s.acctstarttime)}</td>
                            <td className="py-2 px-3">{s.acctstoptime ? datet(s.acctstoptime) : <span className="text-emerald-500 font-bold">Active Live</span>}</td>
                            <td className="py-2 px-3">{s.acctterminatecause || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {detailTab === 'recharges' && (
              <div className="space-y-3">
                {(!selectedForDetail.recharges || selectedForDetail.recharges.length === 0) ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    No recharge history records found.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 font-semibold">
                          <th className="py-2.5 px-3">Reference</th>
                          <th className="py-2.5 px-3">Plan</th>
                          <th className="py-2.5 px-3">Price Paid</th>
                          <th className="py-2.5 px-3">Validity Days</th>
                          <th className="py-2.5 px-3">Period Range</th>
                          <th className="py-2.5 px-3">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {selectedForDetail.recharges.map((r: any) => (
                          <tr key={r.id} className="hover:bg-slate-50/50">
                            <td className="py-2 px-3 font-mono font-medium">{r.reference}</td>
                            <td className="py-2 px-3">{r.plan?.name || '—'}</td>
                            <td className="py-2 px-3 font-bold">{rs(r.price)}</td>
                            <td className="py-2 px-3">{r.validity_days} Days</td>
                            <td className="py-2 px-3 text-[11px] text-slate-500">
                              {date(r.period_start)} → {date(r.period_end)}
                            </td>
                            <td className="py-2 px-3">{datet(r.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Confirmation Modals for Actions */}
      <ConfirmModal
        open={confirmModal.open}
        onClose={() => setConfirmModal({ open: false, type: 'suspend', customer: null })}
        onConfirm={handleConfirmAction}
        title={
          confirmModal.type === 'suspend'
            ? 'Suspend PPPoE Subscriber'
            : confirmModal.type === 'resume'
            ? 'Resume PPPoE Subscriber'
            : confirmModal.type === 'disconnect'
            ? 'Disconnect Active Session'
            : 'Delete PPPoE Subscriber'
        }
        message={
          confirmModal.type === 'suspend'
            ? `Are you sure you want to suspend subscriber "${confirmModal.customer?.username}"? Their active session will be disconnected and further logins blocked.`
            : confirmModal.type === 'resume'
            ? `Are you sure you want to resume subscriber "${confirmModal.customer?.username}"? FreeRADIUS access will be restored immediately.`
            : confirmModal.type === 'disconnect'
            ? `Send a CoA disconnect request for subscriber "${confirmModal.customer?.username}"? Their active session will terminate immediately.`
            : `Are you sure you want to permanently delete subscriber "${confirmModal.customer?.username}"? Their credentials will be erased from FreeRADIUS.`
        }
        confirmText={
          confirmModal.type === 'suspend'
            ? 'Suspend Subscriber'
            : confirmModal.type === 'resume'
            ? 'Resume Subscriber'
            : confirmModal.type === 'disconnect'
            ? 'Disconnect Session'
            : 'Delete Subscriber'
        }
      />
    </div>
  )
}
