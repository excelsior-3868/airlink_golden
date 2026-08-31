import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Ticket, Download, Zap, Printer, Layers, BarChart3, Calendar, Sparkles, Sun, Leaf, Snowflake, Send } from 'lucide-react'
import { createPortal } from 'react-dom'
import { api, apiError } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, date, datet, num } from '../lib/format'
import { statusPill } from '../lib/format'
import { GlassCard, PageTitle, Pagination, Pill, Modal, EmptyState, CustomSelect, Spinner, StatCard, ActionsMenu } from '../components/ui'
import { DualDatePicker } from '../components/DualDatePicker'
import { VoucherCard } from '../components/VoucherCard'
import VoucherGenerateTab from './VoucherGenerateTab'
import VoucherSalesSummaryTab from './VoucherSalesSummaryTab'
import VoucherUsageModal from '../components/VoucherUsageModal'

// The six summary tiles above the vouchers table. `pick` reads the same shape
// whether it's handed the overall totals or one package type's rollup, so the
// tile and its GB / Wallet split line always agree on what they're counting.
const STAT_CARDS: { label: string; color: string; pick: (t: any) => number }[] = [
  { label: 'Generated', color: 'text-indigo-600', pick: (t) => t?.generated || 0 },
  { label: 'Ready', color: 'text-blue-600', pick: (t) => t?.by_status?.ready || 0 },
  { label: 'Active', color: 'text-emerald-600', pick: (t) => t?.by_status?.active || 0 },
  { label: 'Used', color: 'text-cyan-600', pick: (t) => t?.by_status?.used || 0 },
  { label: 'Disabled', color: 'text-rose-600', pick: (t) => t?.by_status?.disabled || 0 },
]

export default function Vouchers() {
  const { user, refresh, can } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'vouchers' | 'batches' | 'generate' | 'sales-summary' | 'distribution'>('generate')
  const [loadingAction, setLoadingAction] = useState(false)
  const [progress, setProgress] = useState(0)
  
  // Card Print Modal State
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [printTitle, setPrintTitle] = useState('')
  const [printVouchers, setPrintVouchers] = useState<any[]>([])
  const [loadingPrint, setLoadingPrint] = useState(false)

  // Fetch voucher card template once for the page
  const { data: voucherTemplate } = useQuery<any>('voucher-template', () => api.get('/voucher-template').then((r) => r.data.data))

  const [resolvedTemplate, setResolvedTemplate] = useState<any>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)

  useEffect(() => {
    if (printVouchers.length > 0) {
      const first = printVouchers[0]
      const targetUserId = first.seller_id || first.reseller_id || first.owner_id
      if (targetUserId) {
        setLoadingTemplate(true)
        api.get('/voucher-template', { params: { user_id: targetUserId } })
          .then((r) => setResolvedTemplate(r.data.data))
          .catch(() => setResolvedTemplate(voucherTemplate))
          .finally(() => setLoadingTemplate(false))
      } else {
        setResolvedTemplate(voucherTemplate)
      }
    } else {
      setResolvedTemplate(voucherTemplate)
    }
  }, [printVouchers, voucherTemplate])

  const printSingleCard = (v: any) => {
    setPrintTitle(`Voucher Card: ${v.code}`)
    setPrintVouchers([v])
    setPrintModalOpen(true)
  }

  const printBatchCards = async (batchCode: string) => {
    setPrintTitle(`Voucher Cards: Batch ${batchCode}`)
    setPrintVouchers([])
    setLoadingPrint(true)
    setPrintModalOpen(true)
    try {
      const res = await api.get('/vouchers', { params: { batch: batchCode, per_page: 99999 } })
      setPrintVouchers(res.data.data.data || [])
    } catch (e) {
      alert(apiError(e))
      setPrintModalOpen(false)
    } finally {
      setLoadingPrint(false)
    }
  }

  // Vouchers state — includes the reporting filters merged in from the old
  // standalone Voucher Usage Report page (season/date range/package/reseller/seller).
  const [page, setPage] = useState(1)
  // seller_id defaults to 'own' — cards the actor generated itself, with none of
  // its sellers' stock mixed in. 'all' widens it to the whole downline.
  const EMPTY_FILTERS = {
    status: '', code: '', batch: '', serial_number: '',
    from: '', to: '', plan_id: '', reseller_id: '', seller_id: 'own', season_id: '',
  }
  const [filters, setFilters] = useState<any>(EMPTY_FILTERS)
  // Filters apply as soon as they change. Only the free-text fields are debounced
  // so typing doesn't fire a request per keystroke; selects/dates take effect at once.
  const [debouncedText, setDebouncedText] = useState({ code: '', batch: '', serial_number: '' })
  useEffect(() => {
    const t = setTimeout(() => setDebouncedText({ code: filters.code, batch: filters.batch, serial_number: filters.serial_number }), 400)
    return () => clearTimeout(t)
  }, [filters.code, filters.batch, filters.serial_number])

  // Batches state
  const [batchesPage, setBatchesPage] = useState(1)
  const [batchFilters, setBatchFilters] = useState<any>({ plan_id: '', batch_code: '' })
  // Same live-filter behaviour as the vouchers tab: the batch code text is debounced,
  // the plan select takes effect at once.
  const [debouncedBatchCode, setDebouncedBatchCode] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBatchCode(batchFilters.batch_code), 400)
    return () => clearTimeout(t)
  }, [batchFilters.batch_code])

  // Sell state
  const [sellVoucher, setSellVoucher] = useState<any>(null)
  const [usageVoucher, setUsageVoucher] = useState<any>(null)
  const [customerUsername, setCustomerUsername] = useState('')
  const [selling, setSelling] = useState(false)
  const [sellError, setSellError] = useState('')

  // Allocate Voucher state — a Reseller hands off already-generated "ready"
  // stock to one of their own Sellers, by physical serial range. Confirmed
  // with the client: not relevant for an Admin account, which only views the
  // resulting history — an admin never gets the ability to create one.
  const canViewAllocationTab = user?.role === 'admin' || user?.role === 'reseller'
  const [allocateModalOpen, setAllocateModalOpen] = useState(false)
  const [allocateSellerId, setAllocateSellerId] = useState<any>('')
  const [allocateStartSerial, setAllocateStartSerial] = useState('')
  const [allocateQuantity, setAllocateQuantity] = useState('')
  const [allocateNote, setAllocateNote] = useState('')
  const [allocating, setAllocating] = useState(false)
  const [allocateError, setAllocateError] = useState('')
  const [historyPage, setHistoryPage] = useState(1)

  const { data: transferHistory, loading: historyLoading, refetch: refetchHistory } = useQuery<any>(
    `vouchers/transfers?page=${historyPage}`,
    () => api.get('/vouchers/transfers', { params: { page: historyPage, per_page: 15 } }).then((r) => r.data.data),
    { enabled: activeTab === 'distribution' },
  )

  // The reseller's own sellers — the only valid allocation targets.
  const { data: allocateSellers = [] } = useQuery<any[]>(
    'users?role=seller&scope=own',
    () => api.get('/users', { params: { role: 'seller', per_page: 500 } }).then((r) => r.data.data.data),
    { enabled: user?.role === 'reseller' },
  )

  // The next unallocated serial in the reseller's own pool — a fresh batch
  // starts at its first card; once some are already handed off, it advances
  // past them. This drives the Start Serial combobox below so the reseller
  // never has to hunt for or type it.
  const { data: nextSerialInfo, loading: nextSerialLoading } = useQuery<any>(
    'vouchers/next-serial',
    () => api.get('/vouchers/next-serial').then((r) => r.data.data),
    { enabled: allocateModalOpen && user?.role === 'reseller' },
  )
  useEffect(() => {
    if (allocateModalOpen) setAllocateStartSerial(nextSerialInfo?.next_serial || '')
  }, [nextSerialInfo, allocateModalOpen])

  // Derived purely client-side, for the reseller to confirm before submitting —
  // the backend independently computes (and authoritatively validates) the
  // same range server-side.
  const allocateEndSerial = (() => {
    const m = /^(\d{2})-(\d{6})$/.exec(allocateStartSerial.trim())
    const qty = +allocateQuantity
    if (!m || !qty || qty < 1) return ''
    return `${m[1]}-${String(+m[2] + qty - 1).padStart(6, '0')}`
  })()

  const openAllocateModal = () => {
    setAllocateSellerId('')
    setAllocateStartSerial('')
    setAllocateQuantity('')
    setAllocateNote('')
    setAllocating(false)
    setAllocateError('')
    setAllocateModalOpen(true)
  }

  const handleAllocate = async () => {
    if (!allocateSellerId || !allocateStartSerial || !allocateQuantity) return
    setAllocating(true)
    setAllocateError('')
    try {
      await api.post('/vouchers/transfers', {
        to_user_id: allocateSellerId,
        start_serial: allocateStartSerial.trim(),
        quantity: +allocateQuantity,
        note: allocateNote || undefined,
      })
      setAllocateModalOpen(false)
      refetchHistory()
      load()
      refetchBatches()
    } catch (e) {
      setAllocateError(apiError(e))
    } finally {
      setAllocating(false)
    }
  }

  // Reporting extras (season filter, summary cards) are only relevant — and only
  // authorized — for users with the 'reports' permission, same as the old standalone page.
  const canSeeReports = can('reports')
  // Only an admin or reseller has a downline to slice by, so only they get the
  // Seller select — and only they carry a seller_id filter. A seller's own list is
  // already scoped server-side, so the filter is dropped entirely for them.
  const sellerFilterVisible = canSeeReports && (user?.role === 'admin' || user?.role === 'reseller')
  // Only admins and resellers hold both card types; a seller carries GB cards only.
  const showPackageSplit = user?.role === 'admin' || user?.role === 'reseller'
  // "My Own Cards" is a reseller concept — an admin generates no cards of its own,
  // so for an admin the default is no seller filter at all (every card in the tree,
  // narrowed with the Reseller select beside it).
  const sellerScope = user?.role === 'admin' && filters.seller_id === 'own' ? '' : filters.seller_id
  // seller_id is passed through verbatim — the backend resolves 'own' (default),
  // 'all' (every seller's cards, excluding the actor's own) and a specific id.
  const effectiveFilters = {
    ...filters,
    code: debouncedText.code,
    batch: debouncedText.batch,
    serial_number: debouncedText.serial_number,
    seller_id: sellerFilterVisible ? sellerScope : '',
  }
  const cleanFilters = () => Object.fromEntries(Object.entries(effectiveFilters).filter(([, v]) => v))
  const cleanBatchFilters = () => Object.fromEntries(
    Object.entries({ ...batchFilters, batch_code: debouncedBatchCode }).filter(([, v]) => v),
  )

  // Signature of the filters currently in effect — drives the queries below.
  const voucherKey = JSON.stringify(cleanFilters())
  // Any filter change goes back to page 1. Done during render (not in an effect)
  // so the queries below never fire once for a stale page first.
  const prevVoucherKey = useRef(voucherKey)
  if (prevVoucherKey.current !== voucherKey) {
    prevVoucherKey.current = voucherKey
    if (page !== 1) setPage(1)
  }

  const batchKey = JSON.stringify(cleanBatchFilters())
  const prevBatchKey = useRef(batchKey)
  if (prevBatchKey.current !== batchKey) {
    prevBatchKey.current = batchKey
    if (batchesPage !== 1) setBatchesPage(1)
  }

  const { data: plans = [], loading: plansLoading, refetch: refetchPlans } = useQuery<any[]>('plans?active_only=1', () => api.get('/plans', { params: { active_only: 1 } }).then((r) => r.data.data))
  const { data: seasons = [] } = useQuery<any[]>('seasons', () => api.get('/seasons').then((r) => r.data.data), { enabled: canSeeReports })
  const { data: resellers = [] } = useQuery<any[]>('users?role=reseller&per_page=100', () => api.get('/users', { params: { role: 'reseller', per_page: 100 } }).then((r) => r.data.data.data), { enabled: canSeeReports && user?.role === 'admin' })
  const { data: sellers = [] } = useQuery<any[]>('users?role=seller&per_page=500', () => api.get('/users', { params: { role: 'seller', per_page: 500 } }).then((r) => r.data.data.data), { enabled: canSeeReports && (user?.role === 'admin' || user?.role === 'reseller') })

  const { data, loading: vouchersLoading, refetch: load } = useQuery<any>(
    `vouchers?page=${page}&${voucherKey}`,
    () => api.get('/vouchers', { params: { page, ...cleanFilters() } }).then((r) => r.data.data),
  )

  // Usage summary cards, merged in from the old standalone Voucher Usage Report page.
  const { data: summary, loading: summaryLoading, error: summaryError } = useQuery<any>(
    `vouchers/package-summary?${voucherKey}`,
    () => api.get('/reports/package-summary', { params: cleanFilters() }).then((r) => r.data.data),
    { enabled: activeTab === 'vouchers' && canSeeReports },
  )

  const handleSeasonChange = (seasonId: any) => {
    if (!seasonId) {
      setFilters({ ...filters, season_id: '', from: '', to: '' })
      return
    }
    const season = seasons.find((s: any) => s.id === +seasonId)
    if (!season) return
    const currentYear = new Date().getFullYear()
    const sm = season.start_month.toString().padStart(2, '0')
    const sd = season.start_day.toString().padStart(2, '0')
    const em = season.end_month.toString().padStart(2, '0')
    const ed = season.end_day.toString().padStart(2, '0')
    const fromDate = `${currentYear}-${sm}-${sd}`
    const toDate = season.start_month > season.end_month ? `${currentYear + 1}-${em}-${ed}` : `${currentYear}-${em}-${ed}`
    setFilters({ ...filters, season_id: seasonId, from: fromDate, to: toDate })
  }

  const { data: batchesData, loading: batchesLoading, refetch: refetchBatches } = useQuery<any>(
    `batches?page=${batchesPage}&${batchKey}`,
    () => api.get('/batches', { params: { page: batchesPage, ...cleanBatchFilters() } }).then((r) => r.data.data),
    { enabled: activeTab === 'batches' },
  )

  // Plans offered by the Batches filter. /plans is scoped per role, but for a
  // seller it still includes the admin's and their reseller's packages — a seller
  // can only generate from packages they created (see VoucherGenerateTab), so
  // those can never appear in their batch list. Plans referenced by the batches
  // actually loaded are always kept, so the filter can't hide a visible row.
  const batchPlanIds = new Set((batchesData?.data || []).map((b: any) => b.plan_id ?? b.plan?.id))
  const batchPlanOptions = user?.role === 'seller'
    ? plans.filter((p: any) => p.created_by === user?.id || batchPlanIds.has(p.id))
    : plans

  const download = async (kind: 'export' | 'export-xlsx', extraParams?: any) => {
    const res = await api.get(`/vouchers/${kind}`, { params: { ...cleanFilters(), ...extraParams }, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = kind === 'export' ? 'vouchers.csv' : 'vouchers.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const openBlob = async (path: string, params?: any) => {
    setLoadingAction(true)
    setProgress(0)
    
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return 95
        const increment = Math.floor(Math.random() * 8) + 3
        return Math.min(95, prev + increment)
      })
    }, 150)

    try {
      const res = await api.get(path, { params, responseType: 'blob' })
      clearInterval(interval)
      setProgress(100)
      
      await new Promise((r) => setTimeout(r, 200))
      
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
    } catch (e) {
      clearInterval(interval)
      alert(apiError(e))
    } finally {
      setLoadingAction(false)
    }
  }

  const handleSell = async () => {
    if (!sellVoucher) return
    setSelling(true)
    setSellError('')
    try {
      await api.post(`/vouchers/${sellVoucher.id}/sell`, { customer_username: customerUsername })
      setSellVoucher(null)
      setCustomerUsername('')
      load()
      refresh()
    } catch (e) { setSellError(apiError(e)) } finally { setSelling(false) }
  }

  const toggleDisable = async (v: any) => {
    try {
      const endpoint = v.status === 'disabled' ? `/vouchers/${v.id}/enable` : `/vouchers/${v.id}/disable`
      await api.patch(endpoint)
      load()
    } catch (e) {
      alert(apiError(e))
    }
  }

  const resetMac = async (v: any) => {
    if (!confirm(`Clear the locked device for ${v.username}? The next device to log in will be bound instead.`)) return
    try {
      await api.patch(`/vouchers/${v.id}/reset-mac`)
      load()
    } catch (e) {
      alert(apiError(e))
    }
  }

  // Change Password state — matters most for allocated stock: it passes
  // through more hands (Reseller -> Seller -> customer) before sale, so
  // there's more chance the printed code was seen by someone other than the
  // eventual buyer. Confirms in-modal (not a native confirm()) and reveals
  // the new password in-modal (not a native alert()).
  const [changePwVoucher, setChangePwVoucher] = useState<any>(null)
  const [changePwNewValue, setChangePwNewValue] = useState('')
  const [changePwResult, setChangePwResult] = useState('')
  const [changePwError, setChangePwError] = useState('')
  const [changingPw, setChangingPw] = useState(false)

  const openChangePassword = (v: any) => {
    setChangePwVoucher(v)
    setChangePwNewValue('')
    setChangePwResult('')
    setChangePwError('')
    setChangingPw(false)
  }

  const confirmChangePassword = async () => {
    if (!changePwVoucher) return
    setChangingPw(true)
    setChangePwError('')
    try {
      const res = await api.patch(`/vouchers/${changePwVoucher.id}/change-password`, {
        new_password: changePwNewValue.trim() || undefined,
      })
      setChangePwResult(res.data.data.new_password)
      load()
    } catch (e) {
      setChangePwError(apiError(e))
    } finally {
      setChangingPw(false)
    }
  }

  return (
    <div>
      <PageTitle
        title="Voucher Sales"
        subtitle="Generate & manage voucher cards"
        icon={<Ticket size={22} className="text-rose-500" />}
        showBalances={true}
        showOnlineUsers={true}
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-slate-200 pb-2">
        <button 
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'generate' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          onClick={() => setActiveTab('generate')}
        >
          <Zap size={16} /> Generate Voucher
        </button>
        <button 
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'vouchers' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          onClick={() => setActiveTab('vouchers')}
        >
          <Ticket size={16} /> Vouchers List
        </button>
        <button
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'batches' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          onClick={() => setActiveTab('batches')}
        >
          <Layers size={16} /> Batches List
        </button>
        {user?.role !== 'seller' && (
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'sales-summary' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => setActiveTab('sales-summary')}
          >
            <BarChart3 size={16} /> Sales Summary
          </button>
        )}
        {canViewAllocationTab && (
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'distribution' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => setActiveTab('distribution')}
          >
            <Send size={16} /> {user?.role === 'admin' ? 'Allocation History' : 'Allocate Voucher'}
          </button>
        )}
      </div>

      {activeTab === 'vouchers' && (
        <>
          {/* Filters — includes the season/date/package/reseller/seller filters
              merged in from the old standalone Voucher Usage Report page. */}
          <GlassCard className="mb-4 space-y-3 relative z-10">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3">
              {canSeeReports && (
                <>
                  <div className="md:col-span-3">
                    <label className="text-xs font-semibold text-slate-500 block mb-1">Season</label>
                    <CustomSelect
                      className="w-full"
                      value={filters.season_id}
                      onChange={handleSeasonChange}
                      options={[
                        { value: '', label: 'All Seasons', icon: <Calendar size={14} className="text-slate-400" /> },
                        ...seasons.map((s: any) => {
                          let Icon = Calendar
                          let iconColor = 'text-slate-400'
                          if (s.name === 'Spring') { Icon = Sparkles; iconColor = 'text-emerald-500' }
                          else if (s.name === 'Summer') { Icon = Sun; iconColor = 'text-amber-500' }
                          else if (s.name === 'Autumn') { Icon = Leaf; iconColor = 'text-orange-500' }
                          else if (s.name === 'Winter') { Icon = Snowflake; iconColor = 'text-sky-500' }
                          const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                          const sm = MONTH_NAMES[s.start_month - 1] || ''
                          const em = MONTH_NAMES[s.end_month - 1] || ''
                          return { value: s.id, label: `${s.name} (${sm} ${s.start_day}-${em} ${s.end_day})`, icon: <Icon size={14} className={iconColor} /> }
                        })
                      ]}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-500 block mb-1">From Date</label>
                    <DualDatePicker label="From Date" value={filters.from} onChange={(val) => setFilters({ ...filters, from: val })} />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-semibold text-slate-500 block mb-1">To Date</label>
                    <DualDatePicker label="To Date" value={filters.to} onChange={(val) => setFilters({ ...filters, to: val })} />
                  </div>
                </>
              )}
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Status</label>
                <CustomSelect
                  className="w-full"
                  value={filters.status}
                  onChange={(val) => setFilters({ ...filters, status: val })}
                  options={[
                    { value: '', label: 'All Statuses' },
                    { value: 'ready', label: 'Ready' },
                    { value: 'active', label: 'Active' },
                    { value: 'used', label: 'Used' },
                    { value: 'disabled', label: 'Disabled' },
                  ]}
                />
              </div>
              {canSeeReports && (
                <div className="md:col-span-3">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Package</label>
                  <CustomSelect
                    className="w-full"
                    value={filters.plan_id ? +filters.plan_id : ''}
                    onChange={(val) => setFilters({ ...filters, plan_id: val })}
                    options={[{ value: '', label: 'All Packages' }, ...plans.map((p: any) => ({ value: p.id, label: p.name }))]}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col md:flex-row md:items-end gap-3 flex-wrap">
              {canSeeReports && user?.role === 'admin' && (
                <div className="flex-1 min-w-[140px] max-w-[250px]">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Reseller</label>
                  <CustomSelect
                    className="w-full"
                    value={filters.reseller_id ? +filters.reseller_id : ''}
                    onChange={(val) => setFilters({ ...filters, reseller_id: val })}
                    options={[{ value: '', label: 'All Resellers' }, ...resellers.map((r: any) => ({ value: r.id, label: r.name || r.username }))]}
                  />
                </div>
              )}
              {sellerFilterVisible && (
                <div className="flex-1 min-w-[140px] max-w-[250px]">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Seller</label>
                  <CustomSelect
                    className="w-full"
                    placeholder="Select Seller"
                    value={sellerScope === 'all' || sellerScope === 'own' ? sellerScope : (sellerScope ? +sellerScope : '')}
                    onChange={(val) => setFilters({ ...filters, seller_id: val })}
                    options={
                      user?.role === 'admin'
                        // An admin holds no cards of its own, so there is no "My Own
                        // Cards" to exclude: "All Sellers" is simply the unfiltered
                        // tree, matching how "All Resellers" behaves beside it.
                        ? [
                            { value: '', label: 'All Sellers' },
                            ...sellers.map((s: any) => ({ value: s.id, label: s.name || s.username })),
                          ]
                        : [
                            { value: 'own', label: 'My Own Cards' },
                            { value: 'all', label: 'All Sellers' },
                            ...sellers.map((s: any) => ({ value: s.id, label: s.name || s.username })),
                          ]
                    }
                  />
                </div>
              )}
              <div className="flex-1 min-w-[140px] max-w-[250px]">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Serial Number</label>
                <input className="input" value={filters.serial_number} onChange={(e) => setFilters({ ...filters, serial_number: e.target.value })} placeholder="Search Serial Number" />
              </div>
              <div className="flex-1 min-w-[140px] max-w-[250px]">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Code</label>
                <input className="input" value={filters.code} onChange={(e) => setFilters({ ...filters, code: e.target.value })} placeholder="Search Code" />
              </div>
              <div className="flex-1 min-w-[140px] max-w-[250px]">
                <label className="text-xs font-semibold text-slate-500 block mb-1">Batch</label>
                <input className="input" value={filters.batch} onChange={(e) => setFilters({ ...filters, batch: e.target.value })} placeholder="Batch Code" />
              </div>
              <div className="md:ml-auto flex gap-2 shrink-0 w-full md:w-auto">
                <button
                  className="btn-ghost flex-1 md:flex-initial"
                  onClick={() => { setFilters(EMPTY_FILTERS); setDebouncedText({ code: '', batch: '', serial_number: '' }) }}
                >
                  Clear
                </button>
              </div>
            </div>
          </GlassCard>

          {summaryLoading && !summary ? (
            <div className="mb-6"><Spinner /></div>
          ) : null}
          {/* useQuery keeps the last good payload on failure, which on these tiles
              reads as "the filter had no effect" rather than "the request broke".
              Say so instead of showing counts that don't match the table. */}
          {summaryError && (
            <div className="pill danger w-full justify-center py-2 mb-6">
              Summary unavailable for these filters — {summaryError}
            </div>
          )}
          {summary && !summaryError && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
              {STAT_CARDS.flatMap((c) => {
                const card = (
                <StatCard
                  key={c.label}
                  label={c.label}
                  // "Generated", for a Seller, means stock they bought
                  // themselves — a GB Voucher, paid for from their own GB
                  // balance. Wallet-type cards are never self-purchased; a
                  // Seller only ever gets those via a Reseller's Allocate
                  // Voucher action, so counting them here would be wrong —
                  // this reads only the GB half of the total.
                  value={<span className={`${c.color} font-bold`}>{num(user?.role === 'seller' && c.label === 'Generated' ? c.pick(summary.totals.by_package_type?.gb) : c.pick(summary.totals))}</span>}
                  // Admins and resellers deal in two card types with different
                  // pricing and settlement, so each figure is also split GB / Wallet.
                  // A Seller sees the same GB split, but Wallet is replaced with
                  // Allocated — how much of each figure came from a Reseller's
                  // Allocate Voucher action rather than stock the seller generated
                  // themselves (see ReportController::packageSummary — only ever
                  // non-zero for a Seller, the only role a transfer names).
                  sub={showPackageSplit ? (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-emerald-600 font-semibold">GB {num(c.pick(summary.totals.by_package_type?.gb))}</span>
                      <span className="text-slate-300">|</span>
                      <span className="text-sky-600 font-semibold">Wallet {num(c.pick(summary.totals.by_package_type?.wallet))}</span>
                    </span>
                  ) : user?.role === 'seller' && c.label === 'Generated' ? (
                    // Generated's value above is already GB-only, so this just
                    // labels it explicitly — no Allocated pairing here, since
                    // that split only makes sense once a card has an actual
                    // status, which Generated isn't one of.
                    <span className="text-emerald-600 font-semibold">GB {num(c.pick(summary.totals.by_package_type?.gb))}</span>
                  ) : user?.role === 'seller' ? (
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-emerald-600 font-semibold">GB {num(c.pick(summary.totals.by_package_type?.gb))}</span>
                      <span className="text-slate-300">|</span>
                      <span className="text-sky-600 font-semibold">Allocated {num(c.pick(summary.totals.by_allocation?.allocated))}</span>
                    </span>
                  ) : undefined}
                />
                )
                // Sits right after Generated: the total of all cards this
                // seller has ever received via a Reseller's Allocate Voucher
                // action, across every status (Ready/Active/Used, same
                // "live stock" definition Generated itself excludes Disabled
                // from) — the single-glance counterpart to the per-tile
                // Allocated split shown below.
                if (c.label === 'Generated' && user?.role === 'seller') {
                  return [card, (
                    <StatCard
                      key="total-allocated"
                      label="Total Allocated Voucher"
                      value={<span className="text-violet-600 font-bold">{num(summary.totals.by_allocation?.allocated?.generated || 0)}</span>}
                    />
                  )]
                }
                return [card]
              })}
            </div>
          )}

          <GlassCard className="!p-0 overflow-hidden">
            {vouchersLoading && !data ? <div className="py-8"><Spinner /></div> : null}
            <div className={`overflow-x-auto ${vouchersLoading && !data ? 'hidden' : ''}`}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Serial No.</th>
                    <th>Username</th>
                    <th>Plan</th>
                    <th>Batch</th>
                    <th>Data</th>
                    <th>Used</th>
                    <th>Price</th>
                    <th>Status</th>
                    {canSeeReports && <th>Login Date & Time</th>}
                    {canSeeReports && <th>Customer</th>}
                    {canSeeReports && user?.role !== 'seller' && <th>Reseller</th>}
                    {canSeeReports && user?.role !== 'seller' && <th>Seller</th>}
                    {can('generate_voucher') && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {(data?.data || []).map((v: any, idx: number) => (
                    <motion.tr key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                      <td className="font-mono text-xs text-slate-500">{v.serial_number || '—'}</td>
                      <td className="font-mono font-semibold">{v.code}</td>
                      <td>
                        <span>{v.plan?.name || '—'}</span>
                        {v.plan?.package_type && (
                          <Pill tone={v.plan.package_type === 'gb' ? 'success' : 'info'} className="ml-2">
                            {v.plan.package_type === 'gb' ? 'GB' : 'Card'}
                          </Pill>
                        )}
                      </td>
                      <td>
                        {v.batch?.batch_code ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">
                            <Layers size={11} className="shrink-0 text-slate-400" />
                            {v.batch.batch_code}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{v.data_gb ? gb(v.data_gb) : '—'}</td>
                      <td>{v.data_gb ? `${gb(v.used_gb || 0)} / ${gb(v.data_gb)}` : (v.used_gb ? gb(v.used_gb) : '—')}</td>
                      <td>{rs(v.price)}</td>
                      <td><Pill tone={statusPill[v.status] || 'secondary'}>{v.status}</Pill></td>
                      {canSeeReports && <td className="text-xs font-medium text-slate-700">{v.activated_at ? datet(v.activated_at) : '—'}</td>}
                      {canSeeReports && <td className="font-semibold text-slate-700">{v.customer_username || '—'}</td>}
                      {canSeeReports && user?.role !== 'seller' && (
                        // A card is attributed to either a seller or the reseller
                        // directly, never both — so once a seller owns the row, the
                        // Reseller cell stays blank. An admin keeps the attribution,
                        // since for them it identifies which reseller's chain it is.
                        <td>{v.seller?.username && user?.role !== 'admin' ? '—' : (v.reseller?.username || '—')}</td>
                      )}
                      {canSeeReports && user?.role !== 'seller' && <td>{v.seller?.username || '—'}</td>}
                      {can('generate_voucher') && (
                        <td className="text-right whitespace-nowrap">
                          <ActionsMenu
                            items={[
                              {
                                label: 'Sell',
                                hidden: v.status !== 'ready' || !!(v.seller_id && v.seller_id !== user?.id) || !!(user?.role === 'seller' && v.is_allocated),
                                className: 'text-emerald-600',
                                onClick: () => { setSellVoucher(v); setCustomerUsername(''); setSelling(false); setSellError('') },
                              },
                              {
                                label: 'Usage Graph',
                                // A card still in stock has no accounting history to
                                // plot; once it has been logged into even once there
                                // is something to show.
                                hidden: v.status === 'ready' && !v.activated_at,
                                className: 'text-[#00579f]',
                                onClick: () => setUsageVoucher(v),
                              },
                              {
                                label: v.status === 'disabled' ? 'Enable' : 'Disable',
                                hidden: !!(v.seller_id && v.seller_id !== user?.id) || !!(user?.role === 'seller' && v.is_allocated),
                                className: v.status === 'disabled' ? 'text-sky-600' : 'text-slate-600',
                                onClick: () => toggleDisable(v),
                              },
                              {
                                label: 'Reset MAC',
                                hidden: !(v.mac_bind && v.mac_address),
                                className: 'text-amber-600',
                                onClick: () => resetMac(v),
                              },
                              {
                                label: 'Change Password',
                                className: 'text-fuchsia-600',
                                onClick: () => openChangePassword(v),
                              },
                              {
                                label: 'Card',
                                className: 'text-primary',
                                onClick: () => printSingleCard(v),
                              },
                            ]}
                          />
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {(data?.data || []).length === 0 && <EmptyState>No vouchers match.</EmptyState>}
            </div>
            <div className="p-4"><Pagination meta={data} onPage={setPage} /></div>
          </GlassCard>
        </>
      )}

      {activeTab === 'batches' && (
        <>
          {/* Batch Filters */}
          <GlassCard className="mb-4 flex flex-wrap gap-3 items-end relative z-10">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-500 mb-1">Plan</label>
              <CustomSelect
                value={batchFilters.plan_id ? +batchFilters.plan_id : ''}
                onChange={(val) => setBatchFilters({ ...batchFilters, plan_id: val })}
                options={[
                  { value: '', label: 'All Plans' },
                  ...batchPlanOptions.map((p) => ({ value: p.id, label: p.name }))
                ]}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Batch Code</label>
              <input className="input mt-1" value={batchFilters.batch_code} onChange={(e) => setBatchFilters({ ...batchFilters, batch_code: e.target.value })} placeholder="Search batch" />
            </div>
            <button
              className="btn-ghost"
              onClick={() => { setBatchFilters({ plan_id: '', batch_code: '' }); setDebouncedBatchCode('') }}
            >
              Clear
            </button>
          </GlassCard>

          <GlassCard className="!p-0 overflow-hidden">
            {batchesLoading && !batchesData ? <div className="py-8"><Spinner /></div> : null}
            <div className={`overflow-x-auto ${batchesLoading && !batchesData ? 'hidden' : ''}`}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Batch Code</th>
                    <th>Plan</th>
                    <th>Serial Range</th>
                    <th>Quantity</th>
                    <th>Generated By</th>
                    <th>Created At</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(batchesData?.data || []).map((b: any, idx: number) => (
                    <motion.tr key={b.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                      <td className="font-mono font-semibold">{b.batch_code}</td>
                      <td>
                        <span>{b.plan?.name || '—'}</span>
                        {b.plan?.package_type && (
                          <Pill tone={b.plan.package_type === 'gb' ? 'success' : 'info'} className="ml-2">
                            {b.plan.package_type === 'gb' ? 'GB' : 'Card'}
                          </Pill>
                        )}
                      </td>
                      <td className="font-mono text-xs text-slate-500">{b.serial_start && b.serial_end ? `${b.serial_start} – ${b.serial_end}` : '—'}</td>
                      <td>{b.quantity}</td>
                      <td>{b.generated_by?.username || '—'}</td>
                      <td className="text-xs">{date(b.created_at)}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="text-xs font-bold text-emerald-600 hover:underline mr-3 flex items-center inline-flex gap-1" onClick={() => printBatchCards(b.batch_code)}><Printer size={13} /> Print Cards</button>
                        <button className="text-xs font-bold text-primary hover:underline mr-3 flex items-center inline-flex gap-1" onClick={() => download('export', { batch: b.batch_code })}><Download size={13} /> CSV</button>
                        <button className="text-xs font-bold text-primary hover:underline flex items-center inline-flex gap-1" onClick={() => download('export-xlsx', { batch: b.batch_code })}><Download size={13} /> Excel</button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {(batchesData?.data || []).length === 0 && <EmptyState>No batches found.</EmptyState>}
            </div>
            <div className="p-4"><Pagination meta={batchesData} onPage={setBatchesPage} /></div>
          </GlassCard>
        </>
      )}

      {activeTab === 'generate' && (
        <VoucherGenerateTab
          plans={plans}
          plansLoading={plansLoading}
          refetchPlans={refetchPlans}
          onSuccess={() => {
            load()
            refetchBatches()
          }}
        />
      )}

      {activeTab === 'sales-summary' && <VoucherSalesSummaryTab />}

      {activeTab === 'distribution' && (
        <>
          {/* Admin only ever views the resulting history — allocating stock to a
              Seller is a Reseller-only action, confirmed with the client. */}
          {user?.role === 'reseller' && (
            <GlassCard className="mb-4 flex justify-end relative z-10">
              <button
                className="btn-primary py-2.5 px-5 rounded-2xl font-bold flex items-center gap-2 shadow-md"
                onClick={() => openAllocateModal()}
              >
                <Send size={16} /> Allocate Voucher
              </button>
            </GlassCard>
          )}

          <GlassCard className="!p-0 overflow-hidden">
            <div className="p-4 pb-0">
              <h3 className="text-sm font-bold text-slate-700">Allocation History</h3>
            </div>
            {historyLoading && !transferHistory ? <div className="py-8"><Spinner /></div> : (
              <div className="overflow-x-auto p-4 pt-2">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Batch</th>
                      <th>Serial Range</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Quantity</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(transferHistory?.data || []).map((t: any) => (
                      <tr key={t.id}>
                        <td className="text-xs">{datet(t.created_at)}</td>
                        <td className="font-mono text-xs">{t.batch?.batch_code || '—'}</td>
                        <td className="font-mono text-xs">{t.start_serial ? `${t.start_serial} – ${t.end_serial}` : '—'}</td>
                        <td>{t.from_user?.username || '—'}</td>
                        <td>{t.to_user?.username || '—'}</td>
                        <td className="font-bold">{t.quantity}</td>
                        <td className="text-xs text-slate-500">{t.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(transferHistory?.data || []).length === 0 && <EmptyState>No allocations yet.</EmptyState>}
              </div>
            )}
            <div className="p-4"><Pagination meta={transferHistory} onPage={setHistoryPage} /></div>
          </GlassCard>
        </>
      )}

      {/* Allocate Voucher Modal — Reseller only */}
      <Modal
        open={allocateModalOpen}
        onClose={() => setAllocateModalOpen(false)}
        title="Allocate Voucher"
        subtitle="Hand off already-generated, ready stock to a Seller by its printed serial range — no wallet balance is touched."
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Seller</label>
            <CustomSelect
              searchable
              className="w-full mt-1"
              placeholder="Select seller"
              value={allocateSellerId}
              onChange={setAllocateSellerId}
              options={allocateSellers.map((s: any) => ({ value: s.id, label: s.name || s.username }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Start Serial Number</label>
              <CustomSelect
                className="w-full mt-1"
                buttonClassName="font-mono"
                placeholder={nextSerialLoading ? 'Loading…' : 'No stock available'}
                disabled={!nextSerialInfo?.next_serial}
                value={allocateStartSerial}
                onChange={setAllocateStartSerial}
                options={nextSerialInfo?.next_serial ? [{ value: nextSerialInfo.next_serial, label: nextSerialInfo.next_serial }] : []}
              />
              {!nextSerialLoading && (
                <p className="text-xs text-slate-400 mt-1">
                  {nextSerialInfo?.available ? `${nextSerialInfo.available} unallocated card(s) in stock` : 'Nothing left to allocate'}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Quantity</label>
              <input
                type="number"
                min={1}
                max={nextSerialInfo?.available || undefined}
                className="input mt-1"
                placeholder="e.g. 20"
                value={allocateQuantity}
                onChange={(e) => setAllocateQuantity(e.target.value)}
              />
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-sm flex justify-between">
            <span className="text-muted-foreground">End Serial Number</span>
            <span className="font-mono font-bold">{allocateEndSerial || '—'}</span>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500">Note (optional)</label>
            <input
              className="input mt-1"
              placeholder="e.g. Handed over in person"
              value={allocateNote}
              onChange={(e) => setAllocateNote(e.target.value)}
            />
          </div>
          {allocateError && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">{allocateError}</div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setAllocateModalOpen(false)}>Cancel</button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md"
              disabled={allocating || !allocateSellerId || !allocateStartSerial || !allocateQuantity}
              onClick={handleAllocate}
            >
              {allocating ? 'Allocating…' : 'Allocate Voucher'}
            </motion.button>
          </div>
        </div>
      </Modal>

      <VoucherUsageModal voucher={usageVoucher} onClose={() => setUsageVoucher(null)} />

      {/* Sell Voucher Modal */}
      <Modal open={!!sellVoucher} onClose={() => setSellVoucher(null)} title={`Sell Voucher: ${sellVoucher?.code}`}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Customer Username (Optional)</label>
            <input 
              className="input mt-1" 
              placeholder="e.g. hotel_room_101" 
              value={customerUsername} 
              onChange={(e) => setCustomerUsername(e.target.value)} 
            />
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-bold">{sellVoucher?.plan?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-bold">{rs(sellVoucher?.price)}</span></div>
          </div>
          {sellError && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">{sellError}</div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setSellVoucher(null)}>Cancel</button>
            <motion.button 
              whileTap={{ scale: 0.95 }} 
              className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md" 
              disabled={selling} 
              onClick={handleSell}
            >
              {selling ? 'Selling…' : 'Mark as Sold'}
            </motion.button>
          </div>
        </div>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        open={!!changePwVoucher}
        onClose={() => setChangePwVoucher(null)}
        title={`Change Password: ${changePwVoucher?.username}`}
        subtitle={!changePwResult ? 'Invalidates whatever password is printed on this card — useful if it may have been seen by someone other than the buyer.' : undefined}
      >
        <div className="space-y-4">
          {changePwResult ? (
            <div className="bg-slate-50 rounded-xl p-4 text-center space-y-1">
              <p className="text-xs font-semibold text-slate-500">New Password</p>
              <p className="text-2xl font-mono font-bold text-fuchsia-600 tracking-widest">{changePwResult}</p>
              <p className="text-xs text-slate-400 mt-2">Share this with the customer directly — the printed code no longer works as the password.</p>
            </div>
          ) : (
            <>
              <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-bold font-mono">{changePwVoucher?.username}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Current password</span><span className="font-bold font-mono">{changePwVoucher?.password}</span></div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">New Password</label>
                <input
                  className="input mt-1 font-mono"
                  placeholder="Leave blank to auto-generate a random one"
                  value={changePwNewValue}
                  onChange={(e) => setChangePwNewValue(e.target.value)}
                />
              </div>
            </>
          )}
          {changePwError && (
            <div className="pill danger w-full justify-center py-2 text-xs font-medium">{changePwError}</div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setChangePwVoucher(null)}>
              {changePwResult ? 'Done' : 'Cancel'}
            </button>
            {!changePwResult && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md"
                disabled={changingPw}
                onClick={confirmChangePassword}
              >
                {changingPw ? 'Changing…' : 'Change Password'}
              </motion.button>
            )}
          </div>
        </div>
      </Modal>

      {/* Progress Bar Overlay */}
      {loadingAction && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/45 backdrop-blur-sm select-none">
          <div className="bg-white p-6 rounded-[24px] shadow-2xl flex flex-col items-center gap-4 border border-slate-100 max-w-xs text-center w-80">
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
              <div 
                className="absolute top-0 left-0 h-full bg-[#003164] rounded-full transition-all duration-150 ease-out" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className="mt-1">
              <p className="text-sm font-extrabold text-slate-800">Generating Card Document ({progress}%)</p>
              <p className="text-xs text-slate-400 font-semibold mt-1">Please wait a moment while we render your cards.</p>
            </div>
          </div>
        </div>
      )}

      {/* Print Voucher Cards Modal */}
      <Modal 
        open={printModalOpen} 
        onClose={() => setPrintModalOpen(false)} 
        title={printTitle}
        widthClassName="max-w-4xl"
      >
        <div className="print-modal-content">
          <div className="noprint flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Voucher Cards</p>
              <p className="text-sm font-extrabold text-[#003164]">
                {loadingPrint ? 'Loading vouchers...' : `${printVouchers.length} card(s) ready`}
              </p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => window.print()} 
                disabled={!resolvedTemplate || loadingTemplate || loadingPrint || printVouchers.length === 0} 
                className="btn-primary py-2.5 px-6 rounded-2xl font-bold flex items-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer size={16} /> Print Cards
              </button>
            </div>
          </div>

          {loadingPrint ? (
            <Spinner />
          ) : (!resolvedTemplate || loadingTemplate) ? (
            <div className="py-12 text-center text-slate-500">Loading card template...</div>
          ) : printVouchers.length === 0 ? (
            <div className="py-12 text-center text-slate-500">No cards to display.</div>
          ) : (
            <div className="print-cards-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 justify-items-center max-h-[60vh] overflow-y-auto p-4 bg-slate-50/50 rounded-3xl border border-slate-200/50">
              {printVouchers.map((v) => (
                <div key={v.id} className="print-card-wrapper">
                  <VoucherCard
                    code={v.code}
                    serialNumber={v.serial_number}
                    planName={v.plan?.name}
                    price={v.price}
                    username={v.username}
                    password={v.password}
                    template={resolvedTemplate}
                    size={220}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Portal for clean, style-isolated high-res print output */}
      {printModalOpen && !loadingPrint && resolvedTemplate && !loadingTemplate && printVouchers.length > 0 && createPortal(
        <div className="print-area">
          <div className="print-cards-grid">
            {printVouchers.map((v) => (
              <div key={v.id} className="print-card-wrapper">
                <VoucherCard
                  code={v.code}
                  serialNumber={v.serial_number}
                  planName={v.plan?.name}
                  price={v.price}
                  username={v.username}
                  password={v.password}
                  template={resolvedTemplate}
                  size={265}
                />
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
