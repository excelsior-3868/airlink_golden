import { useEffect, useState, useMemo, Fragment } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, HandCoins, Wallet, Database, UserPlus, Save, Users2, Store, FileText, CreditCard, CheckCircle2, RefreshCw, ChevronDown, ChevronUp, Percent, Coins, PlusCircle, Power, Eye, EyeOff, Edit3, UserMinus, UserCheck, Search, RotateCcw, FilterX, User as UserIcon, Users as UsersIcon } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, date, datet } from '../lib/format'
import { useBranding } from '../lib/branding'
import { GlassCard, PageTitle, Modal, Pill, Pagination, EmptyState, Spinner, CustomSelect, SelectOption, renderPaymentMethodIcon } from '../components/ui'

// Live-typing display formatter for a numeric amount input: inserts Indian-style
// thousand separators on the integer part while preserving an in-progress decimal.
const formatAmountInput = (raw: string) => {
  if (!raw) return ''
  const neg = raw.startsWith('-') ? '-' : ''
  const body = neg ? raw.slice(1) : raw
  const dotIdx = body.indexOf('.')
  const intPart = dotIdx === -1 ? body : body.slice(0, dotIdx)
  const decPart = dotIdx === -1 ? '' : '.' + body.slice(dotIdx + 1)
  const intFormatted = intPart ? Number(intPart).toLocaleString('en-US') : (decPart ? '0' : '')
  return neg + intFormatted + decPart
}

export default function Users({ role }: { role: 'reseller' | 'seller' }) {
  const { user, refresh, can } = useAuth()
  const location = useLocation()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [resellerFilter, setResellerFilter] = useState('all')
  const [sellerFilter, setSellerFilter] = useState('all')

  const [createOpen, setCreateOpen] = useState(false)

  const [paymentMethods, setPaymentMethods] = useState<SelectOption[]>([
    { value: 'CASH', label: 'Cash', icon: renderPaymentMethodIcon('💵', 'CASH') },
    { value: 'QR_ESEWA', label: 'eSewa', icon: renderPaymentMethodIcon('🟢', 'QR_ESEWA') },
    { value: 'QR_KHALTI', label: 'Khalti', icon: renderPaymentMethodIcon('🚀', 'QR_KHALTI') },
    { value: 'CARD', label: 'Card', icon: renderPaymentMethodIcon('💳', 'CARD') },
    { value: 'FONEPAY_QR', label: 'Fonepay QR', icon: renderPaymentMethodIcon('📲', 'FONEPAY_QR') },
  ])

  useEffect(() => {
    api.get('/payment-methods').then((res) => {
      if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        setPaymentMethods(
          res.data.data.map((pm: any) => ({
            value: pm.code,
            label: pm.label,
            icon: renderPaymentMethodIcon(pm.icon, pm.code),
          }))
        )
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (location.search.includes('action=add')) {
      setCreateOpen(true)
    }
  }, [location.search])

  // PPPoE-only: the GB / commission / voucher billing model does not apply.
  const pppoeOnly = useBranding().branding.pppoe_only
  const [form, setForm] = useState<any>({ name: '', username: '', email: '', phone: '', password: '', confirm_password: '', gb_rate: '', commission_percent: '' })
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [fundUser, setFundUser] = useState<any>(null)
  const [fund, setFund] = useState({ amount: '', gb_amount: '', gb_paid: '' })
  const [collectUser, setCollectUser] = useState<any>(null)
  const [collectType, setCollectType] = useState<'gb' | 'commission'>('gb')
  const [collectAmount, setCollectAmount] = useState('')
  const [collectNote, setCollectNote] = useState('')
  const [collectMethod, setCollectMethod] = useState('CASH')
  const [editUser, setEditUser] = useState<any>(null)
  const [editForm, setEditForm] = useState<any>({ name: '', username: '', email: '', phone: '', password: '', parent_id: '', gb_rate: '', commission_percent: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [historyData, setHistoryData] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const toggleExpand = (u: any) => {
    if (expandedUserId === u.id) {
      setExpandedUserId(null)
      setHistoryData([])
      return
    }

    setExpandedUserId(u.id)
    setLoadingHistory(true)
    setHistoryData([])
    Promise.all([
      api.get('/wallet/transactions', { params: { user_id: u.id, per_page: 100 } }),
      api.get('/billing/invoices', { params: { user_id: u.id, per_page: 100 } }),
      api.get('/billing/payments', { params: { user_id: u.id, per_page: 100 } })
    ]).then(([wRes, iRes, pRes]) => {
      const wList = (wRes.data.data?.data || wRes.data.data || []).map((t: any) => ({
        id: t.id,
        kind: 'wallet',
        title: t.type === 'load' ? 'Wallet Loaded' : (t.type === 'refund' ? 'Wallet Refunded' : 'Wallet Transaction'),
        reference: `TX-${t.id}`,
        subtext: `By: ${t.from_user?.username || 'System'} → ${t.to_user?.username || t.user?.username || 'User'}`,
        note: t.note,
        amountLabel: rs(t.amount),
        amountColor: t.type === 'refund' ? 'text-rose-600' : 'text-emerald-600',
        statusBadge: t.type.toUpperCase(),
        statusTone: t.type === 'load' ? 'success' : 'secondary',
        created_at: t.created_at,
        dateObj: new Date(t.created_at),
        sender_id: t.from_user_id,
        receiver_id: t.to_user_id || t.user_id,
      }))

      const iList = (iRes.data.data?.data || iRes.data.data || []).map((t: any) => ({
        id: t.id,
        kind: 'invoice',
        title: `GB Allocation (${gb(t.gb_amount)})`,
        reference: t.invoice_number,
        subtext: `Rate: Rs ${t.rate}/GB · Total: Rs ${t.total_amount} · By: ${t.sender?.username || 'System'}`,
        note: t.status === 'due' && t.paid_amount > 0 ? `Paid: Rs ${t.paid_amount} · Due: Rs ${t.total_amount - t.paid_amount}` : null,
        amountLabel: rs(t.total_amount),
        amountColor: 'text-purple-600',
        dueLabel: t.status !== 'paid' && (t.total_amount - (t.paid_amount || 0)) > 0 ? rs(t.total_amount - (t.paid_amount || 0)) : null,
        statusBadge: t.status.toUpperCase(),
        statusTone: t.status === 'paid' ? 'success' : 'danger',
        created_at: t.created_at,
        dateObj: new Date(t.created_at),
        sender_id: t.sender_id,
        receiver_id: t.receiver_id,
      }))

      const pList = (pRes.data.data?.data || pRes.data.data || []).map((t: any) => ({
        id: t.id,
        kind: 'payment',
        title: 'Payment Received',
        reference: `PAY-${t.id}`,
        subtext: `Collected by: ${t.receiver?.username || 'System'} · From: ${t.sender?.username || 'User'}`,
        note: t.note,
        amountLabel: rs(t.amount),
        amountColor: 'text-emerald-600',
        statusBadge: 'PAID',
        statusTone: 'success',
        created_at: t.payment_date || t.created_at,
        dateObj: new Date(t.payment_date || t.created_at),
        sender_id: t.sender_id,
        receiver_id: t.receiver_id,
      }))

      let filteredW = wList;
      let filteredI = iList;
      let filteredP = pList;

      if (role === 'reseller') {
        filteredI = iList.filter((t: any) => t.receiver_id === u.id);
        filteredP = pList.filter((t: any) => t.receiver_id === user?.id || t.receiver_id === 1);
      } else if (role === 'seller') {
        filteredI = iList.filter((t: any) => t.receiver_id === u.id);
        filteredP = pList.filter((t: any) => t.sender_id === u.id);
      }

      const merged = [...filteredW, ...filteredI, ...filteredP].sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime())
      setHistoryData(merged)
    }).catch(() => {
      setHistoryData([])
    }).finally(() => {
      setLoadingHistory(false)
    })
  }

  const label = role === 'reseller' ? 'Reseller' : 'Seller'

  const queryParams = useMemo(() => {
    const p: Record<string, any> = { role, page, per_page: 15 }
    if (role === 'reseller') {
      if (resellerFilter !== 'all') p.id = resellerFilter
    } else if (role === 'seller') {
      if (user?.role === 'admin' && resellerFilter !== 'all') {
        p.parent_id = resellerFilter
      } else if (user?.role === 'reseller' && sellerFilter !== 'all') {
        p.id = sellerFilter
      }
    }
    if (statusFilter !== 'all') p.status = statusFilter
    return p
  }, [role, page, statusFilter, resellerFilter, sellerFilter, user?.role])

  const queryKey = useMemo(() => {
    return `users?${new URLSearchParams(queryParams as any).toString()}`
  }, [queryParams])

  const { data, loading: usersLoading, refetch } = useQuery<any>(
    queryKey,
    () => api.get('/users', { params: queryParams }).then((r) => r.data.data),
  )

  const { data: resellers = [] } = useQuery<any[]>(
    'users?role=reseller&per_page=200',
    () => api.get('/users', { params: { role: 'reseller', per_page: 200 } }).then((r) => r.data.data.data || r.data.data),
    { enabled: user?.role === 'admin' || role === 'reseller' },
  )

  const filterResellerOptions = useMemo(() => {
    const opts: SelectOption[] = [
      {
        value: 'all',
        label: 'All Resellers',
        icon: <UsersIcon size={16} className="text-slate-400" />
      }
    ]
    const list = role === 'reseller' ? (resellers.length > 0 ? resellers : (data?.data || [])) : resellers
    list.forEach((r: any) => opts.push({
      value: String(r.id),
      label: r.name,
      keywords: r.username,
      icon: <UserIcon size={16} className="text-indigo-500" />
    }))
    return opts
  }, [role, resellers, data?.data])

  const { data: allSellersList = [] } = useQuery<any[]>(
    'users?role=seller&per_page=200',
    () => api.get('/users', { params: { role: 'seller', per_page: 200 } }).then((r) => r.data.data.data || r.data.data),
    { enabled: role === 'seller' && user?.role === 'reseller' },
  )

  const filterSellerOptions = useMemo(() => {
    const opts: SelectOption[] = [
      {
        value: 'all',
        label: 'All Sellers',
        icon: <UsersIcon size={16} className="text-slate-400" />
      }
    ]
    const list = allSellersList.length > 0 ? allSellersList : (data?.data || [])
    list.forEach((s: any) => opts.push({
      value: String(s.id),
      label: s.name,
      keywords: s.username,
      icon: <UserIcon size={16} className="text-indigo-500" />
    }))
    return opts
  }, [allSellersList, data?.data])

  const statusOptions: SelectOption[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'disabled', label: 'Disabled' },
  ]

  const load = () => {
    refetch()
    invalidateCache('users'); invalidateCache('dashboard'); invalidateCache('wallet'); invalidateCache('gb')
  }

  useEffect(() => { setPage(1) }, [role, statusFilter, resellerFilter, sellerFilter])
  useEffect(() => { setExpandedUserId(null); setHistoryData([]) }, [role, page, statusFilter, resellerFilter, sellerFilter])

  const openEditUser = (u: any) => {
    setEditUser(u)
    setEditForm({
      name: u.name || '',
      username: u.username || '',
      email: u.email || '',
      phone: u.phone || '',
      password: '',
      parent_id: u.parent_id || '',
      gb_rate: u.gb_rate !== undefined && u.gb_rate !== null ? String(u.gb_rate) : '',
      commission_percent: u.commission_percent !== undefined && u.commission_percent !== null ? String(u.commission_percent) : '',
    })
    setErr('')
  }

  const saveEditUser = async () => {
    if (editForm.email && editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim())) {
      setErr('Please enter a valid email address.')
      return
    }
    if (editForm.phone && editForm.phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(editForm.phone.trim())) {
      setErr('Please enter a valid phone number.')
      return
    }
    if (editForm.password && editForm.password.length < 6) {
      setErr('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const payload: any = { ...editForm }
      if (!payload.password) delete payload.password
      if (user?.role !== 'admin' || !payload.gb_rate || String(payload.gb_rate).trim() === '') {
        delete payload.gb_rate
      }
      if (role !== 'reseller' || user?.role !== 'admin' || !payload.commission_percent || String(payload.commission_percent).trim() === '') {
        delete payload.commission_percent
      }
      if (role !== 'seller' || user?.role !== 'admin' || !payload.parent_id) {
        delete payload.parent_id
      }
      await api.put(`/users/${editUser.id}`, payload)
      setEditUser(null)
      load()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const saveUser = async () => {
    if (form.email && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setErr('Please enter a valid email address.')
      return
    }
    if (form.phone && form.phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(form.phone.trim())) {
      setErr('Please enter a valid phone number.')
      return
    }
    if (form.password && form.password !== form.confirm_password) {
      setErr('Passwords do not match.')
      return
    }
    if (!pppoeOnly && role === 'reseller' && user?.role === 'admin' && (!form.commission_percent || String(form.commission_percent).trim() === '')) {
      setErr('Commission % is required for resellers.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const pid = user!.id
      const payload = { ...form }
      delete payload.confirm_password
      if (user?.role !== 'admin' || !payload.gb_rate || String(payload.gb_rate).trim() === '') {
        delete payload.gb_rate
      }
      if (role !== 'reseller' || user?.role !== 'admin') {
        delete payload.commission_percent
      }
      await api.post(`/${role}s`, { ...payload, parent_id: pid })
      setCreateOpen(false)
      setForm({ name: '', username: '', email: '', phone: '', password: '', confirm_password: '', gb_rate: '', commission_percent: '' })
      setShowPw(false)
      setShowConfirmPw(false)
      load()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (u: any) => {
    const status = u.status === 'active' ? 'disabled' : 'active'
    try { await api.patch(`/users/${u.id}/status`, { status }); load() } catch (e) { alert(apiError(e)) }
  }

  const saveFund = async () => {
    setBusy(true)
    setErr('')
    try {
      const walletAmt = +fund.amount || 0
      const gbAmt = +fund.gb_amount || 0
      const gbTotal = gbAmt * +(fundUser?.gb_rate || 0)
      const totalCost = walletAmt + gbTotal
      const paidNow = Math.min(+fund.gb_paid || 0, totalCost)
      // Payment applies to the GB cost first, any leftover settles the wallet portion.
      const paidToGb = Math.min(paidNow, gbTotal)
      const paidToWallet = paidNow - paidToGb

      if (walletAmt > 0) await api.post('/wallet/load', { user_id: fundUser.id, amount: walletAmt, paid_amount: paidToWallet })
      if (gbAmt > 0) {
        await api.post('/gb/allocate', {
          user_id: fundUser.id,
          gb_amount: gbAmt,
          paid_amount: paidToGb,
        })
      }
      setFundUser(null); setFund({ amount: '', gb_amount: '', gb_paid: '' }); setExpandedUserId(null); setHistoryData([]); load(); refresh()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  // Commission is only ever collected by the admin from its resellers; a reseller
  // settles GB dues with its sellers, so it never sees the commission option.
  const canCollectCommission = user?.role === 'admin'
  const activeCollectType = canCollectCommission ? collectType : 'gb'

  const savePayment = async () => {
    if (!collectUser) return
    setBusy(true)
    setErr('')
    try {
      const endpoint = activeCollectType === 'commission' ? '/billing/commission/collect' : '/billing/payments/collect'
      await api.post(endpoint, {
        user_id: collectUser.id,
        amount: +collectAmount,
        note: collectNote || undefined,
        payment_method: collectMethod
      })
      setCollectUser(null)
      setCollectAmount('')
      setCollectNote('')
      setCollectMethod('CASH')
      load()
      refresh()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageTitle title={`Add/View ${label}s`} subtitle={`Manage your ${label.toLowerCase()} network`}
        icon={role === 'reseller' ? <Users2 size={22} className="text-purple-500" /> : <Store size={22} className="text-amber-500" />}
        showBalances={true}
        showOnlineUsers={true}
        action={(role !== 'seller' || user?.role !== 'admin') && (
          <motion.button whileTap={{ scale: 0.95 }} className="btn-primary flex items-center gap-2" onClick={() => { setErr(''); setCreateOpen(true) }}><Plus size={16} /> New {label}</motion.button>
        )} />

      {/* Action Guide / Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3.5 px-4 py-2.5 bg-slate-50 border border-slate-200/50 rounded-2xl text-xs text-slate-500 shadow-sm">
        <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Action Guide:</span>
        {role === 'seller' && user?.role === 'admin' ? (
          <span className="flex items-center gap-1.5">
            <span className="p-1 rounded-md bg-slate-100 text-slate-600 inline-flex"><ChevronDown size={12} /></span>
            <span>View Details & Transactions</span>
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="p-1 rounded-md bg-sky-50 text-sky-600 inline-flex"><Edit3 size={12} /></span>
              <span>Edit {label}</span>
            </span>
            {!pppoeOnly && can('wallet_load') && (
              <span className="flex items-center gap-1.5">
                <span className="p-1 rounded-md bg-emerald-50 text-emerald-600 inline-flex"><CreditCard size={12} /></span>
                <span>Collect Payment</span>
              </span>
            )}
            {!(pppoeOnly && user?.role !== 'admin') && (
              <span className="flex items-center gap-1.5">
                <span className="p-1 rounded-md bg-slate-100 text-primary inline-flex"><Wallet size={12} /></span>
                <span>{user?.role === 'admin' && role !== 'seller' ? (pppoeOnly ? 'Load Wallet' : 'Load Wallet/GB') : 'Allocate GB'}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="p-1 rounded-md bg-rose-50 text-rose-500 inline-flex"><UserMinus size={12} /></span>
              <span>Enable/Disable</span>
            </span>
          </>
        )}
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-100/80 mb-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            {role === 'reseller' ? (
              /* Reseller Page: Double-width Reseller Combobox (sm:w-80) + Status Combobox (sm:w-44) */
              <>
                <div className="w-full sm:w-80 shrink-0">
                  <CustomSelect
                    value={resellerFilter}
                    onChange={(v) => setResellerFilter(String(v))}
                    options={filterResellerOptions}
                    placeholder="All Resellers"
                    searchable={true}
                    className="w-full"
                  />
                </div>

                <div className="w-full sm:w-44 shrink-0">
                  <CustomSelect
                    value={statusFilter}
                    onChange={(v) => setStatusFilter(String(v))}
                    options={statusOptions}
                    className="w-full"
                  />
                </div>
              </>
            ) : (
              /* Seller Page: Double-width Combobox (sm:w-80) + Status Combobox (sm:w-44) */
              <>
                {user?.role === 'admin' ? (
                  <div className="w-full sm:w-80 shrink-0">
                    <CustomSelect
                      value={resellerFilter}
                      onChange={(v) => setResellerFilter(String(v))}
                      options={filterResellerOptions}
                      placeholder="All Resellers"
                      searchable={true}
                      className="w-full"
                    />
                  </div>
                ) : (
                  <div className="w-full sm:w-80 shrink-0">
                    <CustomSelect
                      value={sellerFilter}
                      onChange={(v) => setSellerFilter(String(v))}
                      options={filterSellerOptions}
                      placeholder="All Sellers"
                      searchable={true}
                      className="w-full"
                    />
                  </div>
                )}

                <div className="w-full sm:w-44 shrink-0">
                  <CustomSelect
                    value={statusFilter}
                    onChange={(v) => setStatusFilter(String(v))}
                    options={statusOptions}
                    className="w-full"
                  />
                </div>
              </>
            )}

            {(statusFilter !== 'all' || resellerFilter !== 'all' || sellerFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all')
                  setResellerFilter('all')
                  setSellerFilter('all')
                }}
                className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition flex items-center gap-1.5 shrink-0"
                title="Reset Filters"
              >
                <RotateCcw size={14} /> Clear Filter
              </button>
            )}
          </div>
        </div>
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        {data && data.total > 0 && (
          <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>
              Showing {data.from || 0} to {data.to || 0} of {data.total || 0} {role === 'reseller' ? 'resellers' : 'sellers'}
            </span>
          </div>
        )}
        {usersLoading && !data ? (
          <Spinner />
        ) : null}
        <div className={`overflow-x-auto ${usersLoading && !data ? 'hidden' : ''}`}>
          <table className="w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                {role === 'seller' && user?.role === 'admin' && <th>Parent Reseller</th>}
                {role === 'reseller' && <th>Wallet Balance</th>}
                {pppoeOnly && role === 'reseller' && <th>Commission %</th>}
                {!pppoeOnly && (
                  <>
                    <th>GB Balance</th>
                    <th>GB Rate</th>
                    {role === 'reseller' && <th>Commission %</th>}
                    <th>GB Allocation Due</th>
                    {role === 'reseller' && <th>Commission Due</th>}
                    <th>Vouchers Generated</th>
                  </>
                )}
                {role === 'reseller' && !pppoeOnly && <th>Sellers</th>}
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(data?.data || []).map((u: any, idx: number) => {
                const isExpanded = expandedUserId === u.id;
                return (
                  <Fragment key={u.id}>
                    <motion.tr 
                      initial={{ opacity: 0, x: -10 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      transition={{ delay: idx * 0.03 }} 
                      className="hover:bg-secondary/30 cursor-pointer select-none"
                      onClick={() => toggleExpand(u)}
                    >
                      <td className="font-semibold text-slate-800">{u.name}</td>
                      <td className="font-mono text-xs">{u.username}</td>
                      {role === 'seller' && user?.role === 'admin' && (
                        <td>
                          {u.parent?.name ? (
                            <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50 whitespace-nowrap">
                              {u.parent.name}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      {role === 'reseller' && <td className="font-semibold text-emerald-700">{rs(u.wallet_balance)}</td>}
                      {pppoeOnly && role === 'reseller' && <td>{u.commission_percent ?? 0}%</td>}
                      {!pppoeOnly && (
                        <>
                          <td>{gb(u.gb_balance)}</td>
                          <td>{rs(u.gb_rate)}/GB</td>
                          {role === 'reseller' && <td>{u.commission_percent ?? 0}%</td>}
                          <td className="text-amber-700 font-semibold">{rs(u.wallet_due)}</td>
                          {role === 'reseller' && <td className="text-rose-600 font-semibold">{rs(u.commission_due)}</td>}
                          <td className="font-semibold text-slate-700">{u.vouchers_count ?? 0}</td>
                        </>
                      )}
                      {role === 'reseller' && !pppoeOnly && <td>{u.children_count ?? 0}</td>}
                      <td><Pill tone={u.status === 'active' ? 'success' : 'danger'}>{u.status === 'active' ? 'Active' : 'Disabled'}</Pill></td>
                      <td className="text-right pr-6 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {!(role === 'seller' && user?.role === 'admin') && (
                          <>
                            <button className="text-sky-600 hover:text-sky-800 p-1.5 rounded-lg hover:bg-sky-50 transition-all inline-flex items-center justify-center mr-1" title={`Edit ${label}`} onClick={() => openEditUser(u)}>
                              <Edit3 size={14} />
                            </button>
                            {!pppoeOnly && (+u.wallet_due > 0 || +u.commission_due > 0) && can('wallet_load') && (
                              <button className="text-emerald-600 hover:text-emerald-800 p-1.5 rounded-lg hover:bg-emerald-50 transition-all inline-flex items-center justify-center mr-1" title="Payment" onClick={() => { setCollectUser(u); setCollectType(+u.commission_due > 0 && !(+u.wallet_due > 0) ? 'commission' : 'gb'); setErr(''); setCollectAmount(''); setCollectNote(''); setCollectMethod('CASH'); }}>
                                <CreditCard size={14} />
                              </button>
                            )}
                            {/* An admin funds resellers only — a seller's GB comes
                                from their own reseller. */}
                            {!(user?.role === 'admin' && role === 'seller') && !(pppoeOnly && user?.role !== 'admin') && (
                              <button className="text-primary hover:text-indigo-800 p-1.5 rounded-lg hover:bg-slate-100/80 transition-all inline-flex items-center justify-center mr-1" title={user?.role === 'admin' && role !== 'seller' ? 'Load Wallet/GB' : 'Allocate GB'} onClick={() => { setFundUser(u); setErr(''); setFund({ amount: '', gb_amount: '', gb_paid: '' }); }}>
                                <Wallet size={14} />
                              </button>
                            )}
                            <button className={`${u.status === 'active' ? 'text-rose-500 hover:text-rose-700 hover:bg-rose-50' : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'} p-1.5 rounded-lg transition-all inline-flex items-center justify-center mr-1`} title={u.status === 'active' ? 'Disable' : 'Enable'} onClick={() => toggle(u)}>
                              {u.status === 'active' ? <UserMinus size={14} /> : <UserCheck size={14} />}
                            </button>
                          </>
                        )}
                        <button className="text-slate-500 hover:text-primary p-1.5 rounded-lg hover:bg-slate-100/80 transition-all inline-flex items-center justify-center" title="View Details" onClick={() => toggleExpand(u)}>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                    </motion.tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/40">
                        <td colSpan={pppoeOnly ? 8 : role === 'reseller' ? 12 : (user?.role === 'admin' ? 10 : 9)} className="py-4 px-6 border-b border-slate-200/60">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg shadow-sm border border-purple-200/50 shrink-0">
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-800 text-sm">{u.name}</h4>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                  {u.phone || 'No phone'} · {u.username}{!pppoeOnly && ` · Rate: Rs ${u.gb_rate}/GB`}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold border border-slate-200">
                                {historyData.length} Transactions
                              </span>
                              {historyData[0] && (
                                <span className="text-xs text-slate-400">
                                  Last: {datet(historyData[0].created_at)}
                                </span>
                              )}
                            </div>
                          </div>

                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">Transaction History</p>

                          {loadingHistory ? (
                            <div className="flex justify-center items-center py-8"><Spinner /></div>
                          ) : historyData.length === 0 ? (
                            <EmptyState>No transaction history found for this user.</EmptyState>
                          ) : (
                            <div className="relative border-l border-slate-200 pl-6 ml-4 my-2 space-y-3">
                              {historyData.map((t, i) => {
                                let iconBg = 'bg-blue-500';
                                let iconNode = <CreditCard size={10} className="text-white" />;
                                if (t.kind === 'wallet') {
                                  iconBg = 'bg-emerald-500';
                                  iconNode = <Wallet size={10} className="text-white" />;
                                } else if (t.kind === 'invoice') {
                                  iconBg = 'bg-purple-500';
                                  iconNode = <FileText size={10} className="text-white" />;
                                }

                                return (
                                  <div key={i} className="relative pl-2">
                                    <div className={`absolute -left-[35px] top-3.5 w-5 h-5 rounded-full border border-slate-100 ${iconBg} shadow-sm flex items-center justify-center z-10`}>
                                      {iconNode}
                                    </div>

                                    <div className="bg-white hover:bg-slate-50 border border-slate-100 rounded-xl py-2 px-3 flex justify-between gap-4 transition-colors text-xs items-center shadow-sm">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-bold text-slate-800 text-xs">{t.title}</span>
                                          {i === 0 && (
                                            <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[9px] font-bold border border-emerald-200 uppercase tracking-wide">
                                              Latest
                                            </span>
                                          )}
                                          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[9px] font-bold border border-slate-200 font-mono">
                                            {t.reference}
                                          </span>
                                          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${
                                            t.statusTone === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                            t.statusTone === 'danger' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                                            'bg-slate-50 text-slate-700 border-slate-100'
                                          }`}>
                                            {t.statusBadge}
                                          </span>
                                        </div>

                                        <div className="mt-1 text-slate-500 flex items-center gap-1.5 flex-wrap text-[11px]">
                                          <span>{t.subtext}</span>
                                          {t.note && (
                                            <>
                                              <span className="text-slate-300">|</span>
                                              <span className="text-slate-400 italic">"{t.note}"</span>
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      <div className="text-right shrink-0 flex flex-col justify-between py-0.5">
                                        <p className="text-[10px] text-slate-400">
                                          {datet(t.created_at)}
                                        </p>
                                        <p className={`text-sm font-extrabold mt-1.5 ${t.amountColor}`}>
                                          {t.amountLabel}
                                        </p>
                                        {t.dueLabel && (
                                          <p className="text-[10px] font-bold text-rose-500 mt-0.5">
                                            Due: {t.dueLabel}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {(data?.data || []).length === 0 && <EmptyState>No {label.toLowerCase()}s yet.</EmptyState>}
        </div>
        <div className="p-4"><Pagination meta={data} onPage={setPage} /></div>
      </GlassCard>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={`Create New ${label}`}
        subtitle={`Add a new ${label.toLowerCase()} account to the network without leaving management view.`}
        icon={<UserPlus size={22} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Full Name</label>
              <input className="input" placeholder="e.g. John Doe" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Username</label>
              <input className="input" placeholder="e.g. johndoe" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Email Address</label>
              <input
                className={`input ${form.email && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? 'border-red-400 focus:border-red-500' : ''}`}
                type="email"
                placeholder="e.g. john@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {form.email && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && (
                <p className="text-xs text-red-500 font-semibold mt-1">Please enter a valid email address</p>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Phone Number</label>
              <input
                className={`input ${form.phone && form.phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(form.phone.trim()) ? 'border-red-400 focus:border-red-500' : ''}`}
                placeholder="e.g. +977-98..."
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              {form.phone && form.phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(form.phone.trim()) && (
                <p className="text-xs text-red-500 font-semibold mt-1">Please enter a valid phone number</p>
              )}
            </div>

            {!pppoeOnly && user?.role === 'admin' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1.5">GB Rate (Rs. Per GB)</label>
                <input
                  className="input no-spinners"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 100.00"
                  value={form.gb_rate}
                  onChange={(e) => setForm({ ...form, gb_rate: e.target.value })}
                />
              </div>
            )}

            {user?.role === 'admin' && role === 'reseller' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1.5">
                  {pppoeOnly ? "Commission % (Admin's cut of each PPPoE recharge, optional)" : "Commission % (Admin's cut of each voucher sale)"}
                </label>
                <input
                  className="input no-spinners"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 50"
                  value={form.commission_percent}
                  onChange={(e) => setForm({ ...form, commission_percent: e.target.value })}
                />
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Password</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Confirm Password</label>
              <div className="relative">
                <input
                  className={`input pr-10 ${form.confirm_password && form.confirm_password !== form.password ? 'border-red-400 focus:border-red-500' : ''}`}
                  type={showConfirmPw ? 'text' : 'password'}
                  placeholder="••••••••••••"
                  value={form.confirm_password}
                  onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowConfirmPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {form.confirm_password && form.confirm_password !== form.password && (
                <p className="text-xs text-red-500 font-semibold mt-1">Passwords do not match</p>
              )}
            </div>
          </div>

          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center justify-center gap-2 py-2.5 px-6 rounded-2xl font-bold shadow-md transition-all"
              disabled={busy}
              onClick={saveUser}
            >
              {busy ? (
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {busy ? 'Saving...' : `Save ${label}`}
            </motion.button>
          </div>
        </div>
      </Modal>

      <Modal open={!!fundUser} onClose={() => setFundUser(null)} title={user?.role === 'admin' && role !== 'seller' ? `${pppoeOnly ? 'Load Wallet' : 'Load Wallet/GB'} — ${fundUser?.name || ''}` : `Allocate GB — ${fundUser?.name || ''}`}>
        <div className="space-y-3">
          <div className="flex items-center justify-between pb-1 flex-wrap gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your Balance:</span>
            <div className="flex gap-2">
              {user?.role === 'admin' && role !== 'seller' && (
                <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100/80 text-xs font-bold shadow-sm flex items-center gap-1">
                  <Wallet size={12} />
                  Wallet: {rs(user!.wallet_balance)}
                </span>
              )}
              {!pppoeOnly && (
                <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-100/80 text-xs font-bold shadow-sm flex items-center gap-1">
                  <Database size={12} />
                  GB Balance: {gb(user!.gb_balance)}
                </span>
              )}
            </div>
          </div>
          {user?.role === 'admin' && role !== 'seller' && (
            <div className="relative">
              <Wallet size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-10 no-spinners" type="number" placeholder="Wallet amount (Rs)" value={fund.amount} onChange={(e) => setFund({ ...fund, amount: e.target.value })} />
            </div>
          )}
          {!pppoeOnly && (
            <div className="relative">
              <Database size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-10 pr-28 no-spinners" type="number" placeholder="GB amount" value={fund.gb_amount} onChange={(e) => setFund({ ...fund, gb_amount: e.target.value })} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
                @ {rs(fundUser?.gb_rate || 0)}/GB
              </span>
            </div>
          )}

          {+fund.amount > 0 && +fund.amount > +(user?.wallet_balance || 0) && (
            <div className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-xl">
              Insufficient wallet balance. You have {rs(user?.wallet_balance || 0)} available.
            </div>
          )}

          {(+fund.amount > 0 || +fund.gb_amount > 0) && (() => {
            const isFreeResellerWallet = role === 'reseller' && user?.role === 'admin'
            const walletAmt = +fund.amount || 0
            const gbAmt = (+fund.gb_amount || 0) * +(fundUser?.gb_rate || 0)
            const paid = Math.min(+fund.gb_paid || 0, gbAmt)
            const gbDue = Math.max(gbAmt - paid, 0)
            return (
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 space-y-3">
                {walletAmt > 0 && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-semibold">Wallet Price</span>
                      <span className="font-bold text-slate-700">{rs(walletAmt)}</span>
                    </div>
                    {isFreeResellerWallet && (
                      <div className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
                        Free — reseller loads create no due balance. Admin's revenue comes from the commission cut on voucher sales instead.
                      </div>
                    )}
                  </>
                )}
                {gbAmt > 0 && (
                  <>
                    <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                      <span className="text-slate-500 font-semibold">GB Allocation Cost</span>
                      <span className="text-purple-600 font-bold">{rs(gbAmt)}</span>
                    </div>

                    <div className="relative">
                      <Wallet size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        className="input pl-10 no-spinners"
                        type="text"
                        inputMode="decimal"
                        placeholder="Paid Now (Rs) — Optional"
                        value={formatAmountInput(fund.gb_paid)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '')
                          if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
                          const parsed = +raw
                          const next = raw !== '' && !isNaN(parsed) && parsed > gbAmt ? String(gbAmt) : raw
                          setFund({ ...fund, gb_paid: next })
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/70">
                      <span className="text-slate-500 font-semibold">Remaining Due (Added)</span>
                      <span className={`font-bold ${gbDue > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{rs(gbDue)}</span>
                    </div>
                  </>
                )}
                {walletAmt > 0 && gbAmt > 0 && (
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/70">
                    <span className="text-slate-600 font-semibold">Total Amount</span>
                    <span className="font-bold text-blue-700">{rs(walletAmt + gbAmt)}</span>
                  </div>
                )}
              </div>
            )
          })()}
          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-ghost" onClick={() => setFundUser(null)}>Cancel</button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center justify-center gap-2"
              disabled={busy || (!fund.amount && !fund.gb_amount) || (+fund.amount > 0 && +fund.amount > +(user?.wallet_balance || 0))}
              onClick={saveFund}
            >
              {busy && <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
              {busy ? 'Processing…' : 'Load'}
            </motion.button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title={`Edit ${label}: ${editUser?.name || ''}`}
        subtitle={`Update account details and credentials for ${editUser?.username || ''}.`}
        icon={<Edit3 size={22} />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Full Name</label>
              <input className="input" placeholder="e.g. John Doe" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>
            
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Username</label>
              <input className="input" placeholder="e.g. johndoe" value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Email Address</label>
              <input
                className={`input ${editForm.email && editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim()) ? 'border-red-400 focus:border-red-500' : ''}`}
                type="email"
                placeholder="e.g. john@example.com"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
              {editForm.email && editForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim()) && (
                <p className="text-xs text-red-500 font-semibold mt-1">Please enter a valid email address</p>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Phone Number</label>
              <input
                className={`input ${editForm.phone && editForm.phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(editForm.phone.trim()) ? 'border-red-400 focus:border-red-500' : ''}`}
                placeholder="e.g. +977-98..."
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
              />
              {editForm.phone && editForm.phone.trim() && !/^\+?[0-9\s\-()]{7,20}$/.test(editForm.phone.trim()) && (
                <p className="text-xs text-red-500 font-semibold mt-1">Please enter a valid phone number</p>
              )}
            </div>

            {role === 'seller' && user?.role === 'admin' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1.5">Parent Reseller</label>
                <select className="input" value={editForm.parent_id} onChange={(e) => setEditForm({ ...editForm, parent_id: e.target.value })}>
                  <option value="">Select parent reseller…</option>
                  {resellers.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.username})</option>)}
                </select>
              </div>
            )}

            {!pppoeOnly && user?.role === 'admin' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1.5">GB Rate (Rs. Per GB)</label>
                <input
                  className="input no-spinners"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 100.00"
                  value={editForm.gb_rate}
                  onChange={(e) => setEditForm({ ...editForm, gb_rate: e.target.value })}
                />
              </div>
            )}

            {user?.role === 'admin' && role === 'reseller' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-slate-500 block mb-1.5">
                  {pppoeOnly ? "Commission % (Admin's cut of each PPPoE recharge, optional)" : "Commission % (Admin's cut of each voucher sale)"}
                </label>
                <input
                  className="input no-spinners"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 50"
                  value={editForm.commission_percent}
                  onChange={(e) => setEditForm({ ...editForm, commission_percent: e.target.value })}
                />
              </div>
            )}

            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1.5">New Password (optional)</label>
              <input
                className="input"
                type="password"
                placeholder="Leave blank to keep existing password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              />
            </div>
          </div>

          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setEditUser(null)}>
              Cancel
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center justify-center gap-2 py-2.5 px-6 rounded-2xl font-bold shadow-md transition-all"
              disabled={busy}
              onClick={saveEditUser}
            >
              {busy ? (
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {busy ? 'Saving...' : `Update ${label}`}
            </motion.button>
          </div>
        </div>
      </Modal>

      <Modal open={!!collectUser} onClose={() => setCollectUser(null)} title={`Collect Payment — ${collectUser?.name || ''}`} icon={<HandCoins size={20} />}>
        <div className="space-y-4">
          {/* Header Summary Cards — commission due only applies to admin collections */}
          <div className={`grid gap-3 ${canCollectCommission ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className={`p-3 rounded-2xl border transition-all text-xs ${activeCollectType === 'gb' ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50/50 border-slate-200/50'}`}>
              <p className="text-slate-400 font-semibold">GB Allocation Due:</p>
              <p className="text-emerald-600 font-extrabold text-sm mt-0.5">{rs(collectUser?.wallet_due)}</p>
            </div>
            {canCollectCommission && (
              <div className={`p-3 rounded-2xl border transition-all text-xs ${collectType === 'commission' ? 'bg-rose-50/60 border-rose-200' : 'bg-slate-50/50 border-slate-200/50'}`}>
                <p className="text-slate-400 font-semibold">Commission Due:</p>
                <p className="text-rose-600 font-extrabold text-sm mt-0.5">{rs(collectUser?.commission_due)}</p>
              </div>
            )}
          </div>

          {/* Payment Type Switcher Tabs — commission is admin-only */}
          {canCollectCommission && (
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">Collection Type</label>
            <div className="flex bg-slate-100/80 p-1 rounded-2xl gap-1">
              <button
                type="button"
                onClick={() => setCollectType('gb')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  collectType === 'gb'
                    ? 'bg-white text-[#003164] shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                GB Wallet Pending Payment
              </button>
              <button
                type="button"
                onClick={() => setCollectType('commission')}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  collectType === 'commission'
                    ? 'bg-white text-[#003164] shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Commission Payment
              </button>
            </div>
          </div>
          )}

          {/* Target Due & Remaining Display */}
          {+collectAmount > 0 && (
            <div className="bg-blue-50/50 border border-blue-100 p-3 rounded-2xl text-xs flex justify-between items-center">
              <span className="text-slate-500 font-semibold">Remaining {activeCollectType === 'commission' ? 'Commission' : 'GB'} Due:</span>
              <span className="text-blue-900 font-extrabold text-sm">
                {rs(Math.max((activeCollectType === 'commission' ? +(collectUser?.commission_due || 0) : +(collectUser?.wallet_due || 0)) - +collectAmount, 0))}
              </span>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5 flex items-center gap-1">
              <Wallet size={14} className="text-emerald-500" />
              Payment Amount (Rs) — {activeCollectType === 'commission' ? 'Commission Settlement' : 'GB Pending Settlement'}
            </label>
            <input
              className="input no-spinners"
              type="text"
              inputMode="decimal"
              placeholder="e.g. 1000"
              value={collectAmount}
              onChange={(e) => setCollectAmount(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">
              Payment Method
            </label>
            <CustomSelect
              className="w-full"
              value={collectMethod}
              onChange={(val) => setCollectMethod(String(val))}
              options={paymentMethods}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">
              Note / Reference
            </label>
            <input
              className="input"
              placeholder={activeCollectType === 'commission' ? 'e.g. Commission settlement' : 'e.g. GB allocation cash settlement'}
              value={collectNote}
              onChange={(e) => setCollectNote(e.target.value)}
            />
          </div>

          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button className="btn-ghost" onClick={() => setCollectUser(null)}>Cancel</button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center justify-center gap-2"
              disabled={busy || !collectAmount || +collectAmount <= 0}
              onClick={savePayment}
            >
              {busy && <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
              {busy ? 'Processing…' : `Collect ${activeCollectType === 'commission' ? 'Commission' : 'GB Payment'}`}
            </motion.button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
