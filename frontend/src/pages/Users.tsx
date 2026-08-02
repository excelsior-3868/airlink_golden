import { useEffect, useState, Fragment } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Wallet, Database, UserPlus, Save, Users2, Store, FileText, CreditCard, CheckCircle2, RefreshCw, ChevronDown, ChevronUp, Percent, Coins, PlusCircle, Power, Eye, EyeOff, Edit3, UserMinus, UserCheck } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, date, datet } from '../lib/format'
import { GlassCard, PageTitle, Modal, Pill, Pagination, EmptyState, Spinner } from '../components/ui'

// Live-typing display formatter for a numeric amount input: inserts Indian-style
// thousand separators on the integer part while preserving an in-progress decimal.
const formatAmountInput = (raw: string) => {
  if (!raw) return ''
  const neg = raw.startsWith('-') ? '-' : ''
  const body = neg ? raw.slice(1) : raw
  const dotIdx = body.indexOf('.')
  const intPart = dotIdx === -1 ? body : body.slice(0, dotIdx)
  const decPart = dotIdx === -1 ? '' : '.' + body.slice(dotIdx + 1)
  const intFormatted = intPart ? Number(intPart).toLocaleString('en-IN') : (decPart ? '0' : '')
  return neg + intFormatted + decPart
}

export default function Users({ role }: { role: 'reseller' | 'seller' }) {
  const { user, refresh, can } = useAuth()
  const location = useLocation()
  const [page, setPage] = useState(1)

  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (location.search.includes('action=add')) {
      setCreateOpen(true)
    }
  }, [location.search])
  const [form, setForm] = useState<any>({ name: '', username: '', email: '', phone: '', password: '', confirm_password: '', gb_rate: '', commission_percent: '' })
  const [showPw, setShowPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [fundUser, setFundUser] = useState<any>(null)
  const [fund, setFund] = useState({ amount: '', gb_amount: '', gb_paid: '' })
  const [collectUser, setCollectUser] = useState<any>(null)
  const [collectAmount, setCollectAmount] = useState('')
  const [collectNote, setCollectNote] = useState('')
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
        // Reseller page: show only transactions between Admin and Reseller
        filteredI = iList.filter((t: any) => t.receiver_id === u.id);
        filteredP = pList.filter((t: any) => t.receiver_id === user?.id || t.receiver_id === 1); // target receiver is Admin (user.id or 1)
      } else if (role === 'seller') {
        // Seller page: show only transactions between Reseller/Admin and Seller
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

  const { data, loading: usersLoading, refetch } = useQuery<any>(
    `users?role=${role}&page=${page}`,
    () => api.get('/users', { params: { role, page } }).then((r) => r.data.data),
  )
  const { data: resellers = [] } = useQuery<any[]>(
    'users?role=reseller&per_page=100',
    () => api.get('/users', { params: { role: 'reseller', per_page: 100 } }).then((r) => r.data.data.data),
    { enabled: role === 'seller' && user?.role === 'admin' },
  )

  // Refresh this list plus balances/dashboard that a fund/status change affects.
  const load = () => {
    refetch()
    invalidateCache('users'); invalidateCache('dashboard'); invalidateCache('wallet'); invalidateCache('gb')
  }

  useEffect(() => { setPage(1) }, [role])
  useEffect(() => { setExpandedUserId(null); setHistoryData([]) }, [role, page])

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
    if (role === 'reseller' && user?.role === 'admin' && (!form.commission_percent || String(form.commission_percent).trim() === '')) {
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

  const savePayment = async () => {
    if (!collectUser) return
    setBusy(true)
    setErr('')
    try {
      await api.post('/billing/payments/collect', {
        user_id: collectUser.id,
        amount: +collectAmount,
        note: collectNote || undefined
      })
      setCollectUser(null)
      setCollectAmount('')
      setCollectNote('')
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
        action={(role !== 'seller' || user?.role !== 'admin') && (
          <motion.button whileTap={{ scale: 0.95 }} className="btn-primary flex items-center gap-2" onClick={() => { setErr(''); setCreateOpen(true) }}><Plus size={16} /> New {label}</motion.button>
        )} />

      {/* Action Guide / Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3.5 px-4 py-2.5 bg-slate-50 border border-slate-200/50 rounded-2xl text-xs text-slate-500 shadow-sm">
        <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px]">Action Guide:</span>
        <span className="flex items-center gap-1.5">
          <span className="p-1 rounded-md bg-sky-50 text-sky-600 inline-flex"><Edit3 size={12} /></span>
          <span>Edit {label}</span>
        </span>
        {can('wallet_load') && (
          <span className="flex items-center gap-1.5">
            <span className="p-1 rounded-md bg-emerald-50 text-emerald-600 inline-flex"><CreditCard size={12} /></span>
            <span>Collect Payment</span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="p-1 rounded-md bg-slate-100 text-primary inline-flex"><Wallet size={12} /></span>
          <span>{user?.role === 'admin' && role !== 'seller' ? 'Load Wallet/GB' : 'Allocate GB'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="p-1 rounded-md bg-rose-50 text-rose-500 inline-flex"><UserMinus size={12} /></span>
          <span>Enable/Disable</span>
        </span>
      </div>

      <GlassCard className="!p-0 overflow-hidden">
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
                <th>Payment Due</th>
                {role === 'reseller' && <th>Wallet Balance</th>}
                <th>GB Balance</th>
                <th>GB Rate</th>
                {role === 'reseller' && <th>Commission %</th>}
                <th>Vouchers Generated</th>
                {role === 'reseller' && <th>Sellers</th>}
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
                      <td className="text-rose-600 font-semibold">{rs(u.wallet_due)}</td>
                      {role === 'reseller' && <td className="font-semibold text-emerald-700">{rs(u.wallet_balance)}</td>}
                      <td>{gb(u.gb_balance)}</td>
                      <td>{rs(u.gb_rate)}/GB</td>
                      {role === 'reseller' && <td>{u.commission_percent ?? 0}%</td>}
                      <td className="font-semibold text-slate-700">{u.vouchers_count ?? 0}</td>
                      {role === 'reseller' && <td>{u.children_count ?? 0}</td>}
                      <td><Pill tone={u.status === 'active' ? 'success' : 'danger'}>{u.status === 'active' ? 'Active' : 'Disabled'}</Pill></td>
                      <td className="text-right pr-6 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button className="text-sky-600 hover:text-sky-800 p-1.5 rounded-lg hover:bg-sky-50 transition-all inline-flex items-center justify-center mr-1" title={`Edit ${label}`} onClick={() => openEditUser(u)}>
                          <Edit3 size={14} />
                        </button>
                        {+u.wallet_due > 0 && can('wallet_load') && (
                          <button className="text-emerald-600 hover:text-emerald-800 p-1.5 rounded-lg hover:bg-emerald-50 transition-all inline-flex items-center justify-center mr-1" title="Payment" onClick={() => { setCollectUser(u); setErr(''); setCollectAmount(''); setCollectNote(''); }}>
                            <CreditCard size={14} />
                          </button>
                        )}
                        <button className="text-primary hover:text-indigo-800 p-1.5 rounded-lg hover:bg-slate-100/80 transition-all inline-flex items-center justify-center mr-1" title={user?.role === 'admin' && role !== 'seller' ? 'Load Wallet/GB' : 'Allocate GB'} onClick={() => { setFundUser(u); setErr(''); setFund({ amount: '', gb_amount: '', gb_paid: '' }); }}>
                          <Wallet size={14} />
                        </button>
                        <button className={`${u.status === 'active' ? 'text-rose-500 hover:text-rose-700 hover:bg-rose-50' : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'} p-1.5 rounded-lg transition-all inline-flex items-center justify-center mr-1`} title={u.status === 'active' ? 'Disable' : 'Enable'} onClick={() => toggle(u)}>
                          {u.status === 'active' ? <UserMinus size={14} /> : <UserCheck size={14} />}
                        </button>
                        <button className="text-slate-500 hover:text-primary p-1.5 rounded-lg hover:bg-slate-100/80 transition-all inline-flex items-center justify-center" onClick={() => toggleExpand(u)}>
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                    </motion.tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/40">
                        <td colSpan={role === 'reseller' ? 11 : (user?.role === 'admin' ? 9 : 8)} className="py-4 px-6 border-b border-slate-200/60">
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg shadow-sm border border-purple-200/50 shrink-0">
                                {u.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-800 text-sm">{u.name}</h4>
                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                  {u.phone || 'No phone'} · {u.username} · Rate: Rs {u.gb_rate}/GB
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

            {user?.role === 'admin' && (
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
                <label className="text-xs font-bold text-slate-500 block mb-1.5">Commission % (Admin's cut of each voucher sale)</label>
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

      <Modal open={!!fundUser} onClose={() => setFundUser(null)} title={user?.role === 'admin' && role !== 'seller' ? `Load Wallet/GB — ${fundUser?.name || ''}` : `Allocate GB — ${fundUser?.name || ''}`}>
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
              <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-100/80 text-xs font-bold shadow-sm flex items-center gap-1">
                <Database size={12} />
                GB Balance: {gb(user!.gb_balance)}
              </span>
            </div>
          </div>
          {user?.role === 'admin' && role !== 'seller' && (
            <div className="relative">
              <Wallet size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-10 no-spinners" type="number" placeholder="Wallet amount (Rs)" value={fund.amount} onChange={(e) => setFund({ ...fund, amount: e.target.value })} />
            </div>
          )}
          <div className="relative">
            <Database size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10 pr-28 no-spinners" type="number" placeholder="GB amount" value={fund.gb_amount} onChange={(e) => setFund({ ...fund, gb_amount: e.target.value })} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">
              @ {rs(fundUser?.gb_rate || 0)}/GB
            </span>
          </div>

          {+fund.amount > 0 && +fund.amount > +(user?.wallet_balance || 0) && (
            <div className="text-xs font-medium text-rose-600 bg-rose-50 border border-rose-100 p-2.5 rounded-xl">
              Insufficient wallet balance. You have {rs(user?.wallet_balance || 0)} available.
            </div>
          )}

          {(+fund.amount > 0 || +fund.gb_amount > 0) && (() => {
            const isFreeReseller = role === 'reseller' && user?.role === 'admin'
            const walletAmt = +fund.amount || 0
            const gbAmt = (+fund.gb_amount || 0) * +(fundUser?.gb_rate || 0)
            const totalCost = walletAmt + gbAmt
            const paid = isFreeReseller ? totalCost : Math.min(+fund.gb_paid || 0, totalCost)
            const due = isFreeReseller ? 0 : Math.max(totalCost - paid, 0)
            return (
              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 space-y-3">
                {walletAmt > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-semibold">Wallet Price</span>
                    <span className="font-bold text-slate-700">{rs(walletAmt)}</span>
                  </div>
                )}
                {gbAmt > 0 && (
                  <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                    <span className="text-slate-500 font-semibold">GB Allocation cost</span>
                    <span className="text-purple-600 font-bold">{rs(gbAmt)}</span>
                  </div>
                )}
                {isFreeReseller ? (
                  <div className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
                    Free — reseller loads create no due balance. Admin's revenue comes from the commission cut on voucher sales instead.
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Wallet size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        className="input pl-10 no-spinners"
                        type="text"
                        inputMode="decimal"
                        placeholder="Paid now (Rs) — optional"
                        value={formatAmountInput(fund.gb_paid)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '')
                          if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
                          // Preserve in-progress decimal typing (e.g. "100."); only clamp once it actually exceeds the cap.
                          const parsed = +raw
                          const next = raw !== '' && !isNaN(parsed) && parsed > totalCost ? String(totalCost) : raw
                          setFund({ ...fund, gb_paid: next })
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/70">
                      <span className="text-slate-500 font-semibold">Remaining due (added)</span>
                      <span className={`font-bold ${due > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{rs(due)}</span>
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

            {user?.role === 'admin' && (
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
                <label className="text-xs font-bold text-slate-500 block mb-1.5">Commission % (Admin's cut of each voucher sale)</label>
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

      <Modal open={!!collectUser} onClose={() => setCollectUser(null)} title={`Collect Payment — ${collectUser?.name || ''}`}>
        <div className="space-y-4">
          <div className="bg-slate-50/50 border border-slate-200/50 p-3 rounded-2xl text-xs flex justify-between items-center">
            <div>
              <p className="text-slate-400 font-semibold">Current Payment Due:</p>
              <p className="text-rose-600 font-extrabold text-sm mt-0.5">{rs(collectUser?.wallet_due)}</p>
            </div>
            {+collectAmount > 0 && (
              <div className="text-right">
                <p className="text-slate-400 font-semibold">Remaining Due:</p>
                <p className="text-slate-800 font-bold mt-0.5">{rs(Math.max(+(collectUser?.wallet_due || 0) - +collectAmount, 0))}</p>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5 flex items-center gap-1">
              <Wallet size={14} className="text-emerald-500" />
              Payment Amount (Rs)
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
              Note / Reference
            </label>
            <input
              className="input"
              placeholder="e.g. Cash collection"
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
              {busy ? 'Processing…' : 'Collect'}
            </motion.button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
