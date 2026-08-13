import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wallet, Database, Users2, Store, Ticket, TrendingUp, History, UserCheck, LayoutDashboard, CreditCard, PlusCircle, Package, UserPlus, Receipt, Coins, Sparkles, Layers, Activity, BarChart3, HandCoins } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, num, date, statusPill } from '../lib/format'
import { StatCard, DualStatCard, PageTitle, GlassCard, EmptyState, Modal, Spinner, VoucherStatCard, CustomSelect, SelectOption, renderPaymentMethodIcon, Pill } from '../components/ui'
import { motion } from 'framer-motion'
import FundModal from '../components/FundModal'

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, can } = useAuth()
  const { data: d, loading, setData: setD } = useQuery<any>(
    'dashboard',
    () => api.get('/dashboard').then((r) => r.data.data),
  )

  const [collectOpen, setCollectOpen] = useState(false)
  const [collectType, setCollectType] = useState<'gb' | 'commission'>('gb')
  const [quickFundOpen, setQuickFundOpen] = useState(false)
  const [downlines, setDownlines] = useState<any[]>([])
  const [collectForm, setCollectForm] = useState({ user_id: '', amount: '', note: '', payment_method: 'CASH' })
  const [collectErr, setCollectErr] = useState('')
  const [collectBusy, setCollectBusy] = useState(false)

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

  const fetchDownlines = (currentD: any) => {
    const roleToFetch = currentD.role === 'admin' ? 'reseller' : 'seller'
    api.get('/users', { params: { role: roleToFetch, per_page: 100 } }).then((r) => {
      setDownlines(r.data.data.data)
    })
  }

  // Load downline list once the dashboard data (with role) is available.
  useEffect(() => {
    if (d && (d.role === 'admin' || d.role === 'reseller')) {
      fetchDownlines(d)
    }
  }, [d])

  // Commission is only ever collected by the admin from its resellers; a reseller
  // settles GB dues with its sellers, so it never sees the commission option.
  const canCollectCommission = user?.role === 'admin'
  const activeCollectType = canCollectCommission ? collectType : 'gb'

  const handleCollectPayment = async () => {
    setCollectBusy(true)
    setCollectErr('')
    try {
      const endpoint = activeCollectType === 'commission' ? '/billing/commission/collect' : '/billing/payments/collect'
      await api.post(endpoint, {
        user_id: +collectForm.user_id,
        amount: +collectForm.amount,
        note: collectForm.note || undefined,
        payment_method: collectForm.payment_method,
      })
      const r = await api.get('/dashboard')
      setD(r.data.data)
      setCollectOpen(false)
      setCollectForm({ user_id: '', amount: '', note: '', payment_method: 'CASH' })
    } catch (e: any) {
      setCollectErr(e.response?.data?.message || 'Failed to collect payment.')
    } finally {
      setCollectBusy(false)
    }
  }

  if (loading || !d) return <Spinner />

  // A freshly onboarded account (vouchers generated but none sold yet) still
  // has 14 rows of zeroed-out data, which would otherwise render a flat line
  // and a degenerate, repeated Y-axis (e.g. "Rs 0k" five times over). Show an
  // empty state instead of a chart with nothing to show.
  const dailyTrendHasActivity = d.daily_trend?.some((r: any) => r.count > 0) ?? false

  // Sellers have no downline, so neither action applies to them. Admins fund
  // both wallet and GB; resellers only ever hand GB down to their sellers
  // (FundModal hides the allocation-type switch for non-admins).
  const isDownlineManager = d.role === 'admin' || d.role === 'reseller'
  const showCollect = isDownlineManager && can('wallet_load')
  const showQuickFund = isDownlineManager && (can('allocate_gb') || (d.role === 'admin' && can('wallet_load')))

  return (
    <div>
      <PageTitle
        title="Dashboard"
        subtitle={`${d.role.charAt(0).toUpperCase() + d.role.slice(1)} account overview & billing metrics`}
        icon={<LayoutDashboard size={22} className="text-blue-500" />}
        showOnlineUsers={true}
        action={
          (showCollect || showQuickFund) && (
            <div className="flex items-center gap-2">
              {showCollect && (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="btn-ghost flex items-center gap-2"
                  onClick={() => { setCollectErr(''); setCollectOpen(true) }}
                >
                  <CreditCard size={16} /> Collect Payment
                </motion.button>
              )}
              {showQuickFund && (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="btn-primary flex items-center gap-2"
                  onClick={() => setQuickFundOpen(true)}
                >
                  <PlusCircle size={16} /> Quick Fund
                </motion.button>
              )}
            </div>
          )
        }
      />



      {/* Admin Dashboard */}
      {d.role === 'admin' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Wallet Voucher" value={<span className="text-emerald-600">{num(d.wallet_vouchers?.total || 0)}</span>} icon={<Wallet size={22} />} iconColorClass="text-emerald-600 bg-emerald-50 border border-emerald-100/50" />
            <StatCard label="Total Wallet Voucher Used" value={<span className="text-cyan-600">{num(d.wallet_vouchers?.used ?? d.wallet_vouchers?.by_status?.used ?? 0)}</span>} icon={<Ticket size={22} />} iconColorClass="text-cyan-600 bg-cyan-50 border border-cyan-100/50" />
            <StatCard label="Wallet Distributed" value={<span className="text-blue-600">{rs(d.wallet_distributed)}</span>} icon={<Wallet size={22} />} iconColorClass="text-blue-600 bg-blue-50 border border-blue-100/50" />
            <StatCard label="GB Sold" value={<span className="text-purple-600">{gb(d.gb_distributed)}</span>} icon={<Database size={22} />} iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50" />
            <DualStatCard
              top={{
                label: 'Commission Earned',
                value: rs(d.commission_earned),
                valueColorClass: 'text-amber-600',
                icon: <Coins size={22} />,
                iconColorClass: 'text-amber-600 bg-amber-50 border border-amber-100/50',
                sub: <span>Today: <strong className="text-slate-700">{rs(d.commission_today)}</strong></span>,
              }}
              bottom={{
                label: 'Commission Due',
                value: rs(d.commission_due),
                valueColorClass: 'text-orange-600',
                icon: <Receipt size={22} />,
                iconColorClass: 'text-orange-600 bg-orange-50 border border-orange-100/50',
                sub: <span>Owed by resellers</span>,
              }}
            />
            <DualStatCard
              top={{
                label: 'GB Wallet Payment',
                value: rs(d.collected_from_resellers),
                valueColorClass: 'text-emerald-600',
                icon: <TrendingUp size={22} />,
                iconColorClass: 'text-emerald-600 bg-emerald-50 border border-emerald-100/50',
              }}
              bottom={{
                label: 'GB Wallet Pending Payment',
                value: rs(d.pending_from_resellers),
                valueColorClass: 'text-teal-600',
                icon: <CreditCard size={22} />,
                iconColorClass: 'text-teal-600 bg-teal-50 border border-teal-100/50',
                sub: <span>Owed for allocated GB</span>,
              }}
            />
            <VoucherStatCard title="GB Vouchers" vouchers={d.gb_vouchers || d.vouchers} icon={<Ticket size={22} />} iconColorClass="text-rose-600 bg-rose-50 border border-rose-100/50" valueColorClass="text-rose-600" />
            <VoucherStatCard title="Card Vouchers" vouchers={d.wallet_vouchers || d.vouchers} icon={<Wallet size={22} />} iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50" valueColorClass="text-purple-600" />
          </div>

          {/* Charts Row — system-wide, across all resellers & sellers */}
          {d.daily_trend && d.daily_trend.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Daily Sales Trend */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <GlassCard>
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
                    <TrendingUp size={18} /> Daily Sales Trend
                    <span className="ml-auto text-xs font-normal text-slate-400">Last 14 days</span>
                  </h3>
                  {dailyTrendHasActivity ? (
                  <ResponsiveContainer width="100%" height={200} className="chart-reveal">
                    <AreaChart data={d.daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGradAdminGb" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="salesGradAdminWallet" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={52} tickFormatter={(v) => `Rs ${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => [`Rs ${Number(v).toLocaleString()}`, undefined]} labelStyle={{ fontSize: 11 }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="gb_sales" name="GB Sales" stackId="sales" stroke="#f43f5e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="url(#salesGradAdminGb)" isAnimationActive animationDuration={1700} animationEasing="ease-out" />
                      <Area type="monotone" dataKey="wallet_sales" name="Wallet Sales" stackId="sales" stroke="#a855f7" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="url(#salesGradAdminWallet)" isAnimationActive animationDuration={1700} animationEasing="ease-out" />
                    </AreaChart>
                  </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 200 }} className="flex items-center justify-center">
                      <EmptyState title="No sales yet" subtitle="This will fill in once a voucher is sold." />
                    </div>
                  )}
                </GlassCard>
              </motion.div>

              {/* No. of Vouchers Sold — split by GB vs Wallet */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
                <GlassCard>
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
                    <Ticket size={18} /> No. of Vouchers Sold
                    <span className="ml-auto text-xs font-normal text-slate-400">Last 14 days</span>
                  </h3>
                  {dailyTrendHasActivity ? (
                  <ResponsiveContainer width="100%" height={200} className="chart-reveal">
                    <BarChart data={d.daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} labelStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="gb_count" name="GB Vouchers" stackId="vouchers" fill="#f43f5e" radius={[0, 0, 0, 0]} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                      <Bar dataKey="wallet_count" name="Card Vouchers" stackId="vouchers" fill="#a855f7" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                    </BarChart>
                  </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 200 }} className="flex items-center justify-center">
                      <EmptyState title="No vouchers sold yet" subtitle="This will fill in once a voucher is sold." />
                    </div>
                  )}
                </GlassCard>
              </motion.div>
            </div>
          )}

          {/* Seller & Reseller Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {d.top_resellers && (
              <GlassCard>
                <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
                  <Users2 size={18} /> Top Resellers
                  <span className="ml-auto text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100/50 rounded-full px-2 py-0.5">{num(d.counts?.resellers || 0)} total</span>
                </h3>
                {d.top_resellers.length === 0 ? (
                  <EmptyState>No reseller sales yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {d.top_resellers.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                        <span className="font-semibold text-slate-700">{t.user}</span>
                        <span className="text-slate-500 font-medium">
                          {num(t.vouchers)} vouchers · <span className="text-primary font-bold">{rs(t.revenue)}</span> · <span className="text-amber-600 font-bold">{t.commission_percent}% → {rs(t.commission)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}

            {d.top_sellers && (
              <GlassCard>
                <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
                  <Store size={18} /> Top Sellers
                  <span className="ml-auto text-xs font-semibold text-pink-600 bg-pink-50 border border-pink-100/50 rounded-full px-2 py-0.5">{num(d.counts?.sellers || 0)} total</span>
                </h3>
                {d.top_sellers.length === 0 ? (
                  <EmptyState>No seller sales yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {d.top_sellers.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                        <span className="font-semibold text-slate-700">{t.user}</span>
                        <span className="text-slate-500 font-medium">
                          {num(t.vouchers)} vouchers · <span className="text-primary font-bold">{rs(t.revenue)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            {d.recent_transactions && (
              <GlassCard>
                <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
                  <History size={18} /> Recent Wallet Distributions
                </h3>
                {d.recent_transactions.length === 0 ? (
                  <EmptyState>No transaction history.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {d.recent_transactions.map((t: any) => (
                      <div key={t.id} className="flex justify-between items-center gap-3 text-xs hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-700">{t.user || 'System'}</p>
                          <p className="text-muted-foreground mt-0.5">{t.note}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-primary whitespace-nowrap tabular-nums">+{rs(t.amount)}</p>
                          <p className="text-muted-foreground mt-0.5 whitespace-nowrap">{date(t.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}
          </div>
        </div>
      )}

      {/* Reseller Dashboard */}
      {d.role === 'reseller' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Wallet Balance"
              value={<span className="text-emerald-600">{rs(d.balances.wallet)}</span>}
              icon={<Wallet size={22} />}
              iconColorClass="text-emerald-600 bg-emerald-50 border border-emerald-100/50"
            />
            <StatCard
              label="GB Balance (Stock)"
              value={<span className="text-cyan-600">{gb(d.balances.gb)}</span>}
              icon={<Database size={22} />}
              iconColorClass="text-cyan-600 bg-cyan-50 border border-cyan-100/50"
              sub={<span>Purchased: <strong className="text-slate-700">{gb(d.gb_purchased)}</strong></span>}
            />
            <StatCard
              label="Allowable GB Balance"
              value={<span className="text-indigo-600">{gb(d.balances.gb_allowable ?? d.balances.gb)}</span>}
              icon={<Database size={22} />}
              iconColorClass="text-indigo-600 bg-indigo-50 border border-indigo-100/50"
              sub={<span>Reserved by Vouchers: <strong className="text-slate-700">{gb(d.balances.gb_reserved ?? 0)}</strong></span>}
            />
            <StatCard
              label="GB Allocated to Sellers"
              value={<span className="text-purple-600">{gb(d.gb_allocated)}</span>}
              icon={<Database size={22} />}
              iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50"
              sub={<span>Sellers: <strong className="text-slate-700">{num(d.counts.sellers)}</strong></span>}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="glass-card p-5 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs sm:text-sm font-medium leading-snug">Payment From Sellers</p>
                  <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap text-emerald-600">{rs(d.collected_from_sellers)}</p>
                </div>
                <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-emerald-600 bg-emerald-50 border border-emerald-100/50">
                  <TrendingUp size={22} />
                </div>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs sm:text-sm font-medium leading-snug">Total Receivable from Sellers</p>
                  <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap text-teal-600">{rs(d.outstanding_due)}</p>
                </div>
                <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-teal-600 bg-teal-50 border border-teal-100/50">
                  <CreditCard size={22} />
                </div>
              </div>
            </motion.div>

            <VoucherStatCard title="GB Vouchers" vouchers={d.gb_vouchers || d.vouchers} icon={<Ticket size={22} />} iconColorClass="text-rose-600 bg-rose-50 border border-rose-100/50" valueColorClass="text-rose-600" />
            <VoucherStatCard title="Card Vouchers" vouchers={d.wallet_vouchers || d.vouchers} icon={<Wallet size={22} />} iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50" valueColorClass="text-purple-600" />
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="glass-card p-5 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs sm:text-sm font-medium truncate">GB Voucher Sales</p>
                  <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap text-rose-600">{rs(d.voucher_sales)}</p>
                </div>
                <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-rose-600 bg-rose-50 border border-rose-100/50">
                  <TrendingUp size={22} />
                </div>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs sm:text-sm font-medium">Card Voucher Sales</p>
                  <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap text-purple-600">{rs(d.wallet_voucher_sales)}</p>
                </div>
                <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-purple-600 bg-purple-50 border border-purple-100/50">
                  <TrendingUp size={22} />
                </div>
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="glass-card p-5 flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs sm:text-sm font-medium leading-snug">Commission Due (Card Voucher Sales)</p>
                  <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap text-orange-600">
                    {rs(d.commission_due)} <span className="text-sm font-medium text-orange-400">({d.commission_percent}%)</span>
                  </p>
                </div>
                <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-orange-600 bg-orange-50 border border-orange-100/50">
                  <Receipt size={22} />
                </div>
              </div>
              <div className="h-px bg-slate-200" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs sm:text-sm font-medium leading-snug">Commission Earned (Card Voucher Sales)</p>
                  <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap text-lime-600">{rs(d.commission_net_earnings)}</p>
                </div>
                <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-lime-600 bg-lime-50 border border-lime-100/50">
                  <Sparkles size={22} />
                </div>
              </div>
            </motion.div>
          </div>

          {/* Charts Row */}
          {d.daily_trend && d.daily_trend.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Daily Sales Trend */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <GlassCard>
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
                    <TrendingUp size={18} /> Daily Sales Trend
                    <span className="ml-auto text-xs font-normal text-slate-400">Last 14 days</span>
                  </h3>
                  {dailyTrendHasActivity ? (
                  <ResponsiveContainer width="100%" height={200} className="chart-reveal">
                    <AreaChart data={d.daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGradResellerGb" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="salesGradResellerWallet" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={52} tickFormatter={(v) => `Rs ${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => [`Rs ${Number(v).toLocaleString()}`, undefined]} labelStyle={{ fontSize: 11 }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="gb_sales" name="GB Sales" stackId="sales" stroke="#f43f5e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="url(#salesGradResellerGb)" isAnimationActive animationDuration={1700} animationEasing="ease-out" />
                      <Area type="monotone" dataKey="wallet_sales" name="Wallet Sales" stackId="sales" stroke="#a855f7" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="url(#salesGradResellerWallet)" isAnimationActive animationDuration={1700} animationEasing="ease-out" />
                    </AreaChart>
                  </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 200 }} className="flex items-center justify-center">
                      <EmptyState title="No sales yet" subtitle="This will fill in once a voucher is sold." />
                    </div>
                  )}
                </GlassCard>
              </motion.div>

              {/* No. of Vouchers Sold — split by GB vs Wallet */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
                <GlassCard>
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
                    <Ticket size={18} /> No. of Vouchers Sold
                    <span className="ml-auto text-xs font-normal text-slate-400">Last 14 days</span>
                  </h3>
                  {dailyTrendHasActivity ? (
                  <ResponsiveContainer width="100%" height={200} className="chart-reveal">
                    <BarChart data={d.daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} labelStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="gb_count" name="GB Vouchers" stackId="vouchers" fill="#f43f5e" radius={[0, 0, 0, 0]} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                      <Bar dataKey="wallet_count" name="Card Vouchers" stackId="vouchers" fill="#a855f7" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                    </BarChart>
                  </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 200 }} className="flex items-center justify-center">
                      <EmptyState title="No vouchers sold yet" subtitle="This will fill in once a voucher is sold." />
                    </div>
                  )}
                </GlassCard>
              </motion.div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {d.top_sellers && (
              <GlassCard>
                <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
                  <Store size={18} /> Top Sellers
                  <span className="ml-auto text-xs font-semibold text-pink-600 bg-pink-50 border border-pink-100/50 rounded-full px-2 py-0.5">{num(d.counts?.sellers || 0)} total</span>
                </h3>
                {d.top_sellers.length === 0 ? (
                  <EmptyState>No seller sales yet.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {d.top_sellers.map((t: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                        <span className="font-semibold text-slate-700">{t.user}</span>
                        <span className="text-slate-500 font-medium">
                          {num(t.vouchers)} vouchers · <span className="text-primary font-bold">{rs(t.revenue)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}

            {d.recent_wallet_transfers && (
              <GlassCard>
                <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
                  <History size={18} /> Recent Transactions
                </h3>
                {d.recent_wallet_transfers.length === 0 ? (
                  <EmptyState>No recent transactions found.</EmptyState>
                ) : (
                  <div className="space-y-2">
                    {d.recent_wallet_transfers.map((t: any) => (
                      <div key={t.id} className="flex justify-between items-center gap-3 text-xs hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-700 capitalize">{t.type} transaction</p>
                          <p className="text-muted-foreground mt-0.5">{t.note}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`font-bold whitespace-nowrap tabular-nums ${t.type === 'load' || t.type === 'transfer' || t.is_positive ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {t.type === 'load' || t.type === 'transfer' || t.is_positive ? '+' : '-'}{rs(t.amount)}
                          </p>
                          <p className="text-muted-foreground mt-0.5 whitespace-nowrap">{date(t.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            )}
          </div>
        </div>
      )}

      {/* Seller Dashboard */}
      {d.role === 'seller' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="GB Balance (Stock)" value={<span className="text-cyan-600">{gb(d.balances.gb)}</span>} icon={<Database size={22} />} iconColorClass="text-cyan-600 bg-cyan-50 border border-cyan-100/50" />
            <StatCard
              label="Allowable GB Balance"
              value={<span className="text-indigo-600">{gb(d.balances.gb_allowable ?? d.balances.gb)}</span>}
              icon={<Database size={22} />}
              iconColorClass="text-indigo-600 bg-indigo-50 border border-indigo-100/50"
              sub={<span>Reserved by Vouchers: <strong className="text-slate-700">{gb(d.balances.gb_reserved ?? 0)}</strong></span>}
            />
            <StatCard label="Due Payable" value={<span className="text-rose-600">{rs(d.balances.wallet_due)}</span>} icon={<Wallet size={22} />} iconColorClass="text-rose-600 bg-rose-50 border border-rose-100/50" sub={d.reseller_name ? <span className="text-xs text-slate-500">To: <span className="font-semibold text-slate-700">{d.reseller_name}</span></span> : undefined} />
            {/* Spans both rows so the status chart and its pills get room to breathe. */}
            <VoucherStatCard title="GB Vouchers" vouchers={d.gb_vouchers || d.vouchers} icon={<Ticket size={22} />} iconColorClass="text-rose-600 bg-rose-50 border border-rose-100/50" valueColorClass="text-rose-600" className="lg:row-span-2" />
            <StatCard
              label="Voucher Sales"
              value={<span className="text-blue-600">{rs(d.voucher_sales_to_date ?? 0)}</span>}
              icon={<TrendingUp size={22} />}
              iconColorClass="text-blue-600 bg-blue-50 border border-blue-100/50"
              sub={
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span>Sold till date</span>
                  <span className="text-slate-300">|</span>
                  <span>Today <strong className="text-slate-700">{rs(d.today?.sold_sales ?? 0)}</strong></span>
                </span>
              }
            />
            <StatCard label="Created Voucher Value" value={<span className="text-indigo-600">{rs(d.voucher_sales)}</span>} icon={<TrendingUp size={22} />} iconColorClass="text-indigo-600 bg-indigo-50 border border-indigo-100/50" />
            <StatCard label="Packages" value={<span className="text-amber-600">{num(d.counts.packages)}</span>} icon={<Package size={22} />} iconColorClass="text-amber-600 bg-amber-50 border border-amber-100/50" />
          </div>

          {/* Charts Row */}
          {d.daily_trend && d.daily_trend.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Daily Sales Trend */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                <GlassCard>
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
                    <TrendingUp size={18} /> Daily Sales Trend
                    <span className="ml-auto text-xs font-normal text-slate-400">Last 14 days</span>
                  </h3>
                  {dailyTrendHasActivity ? (
                  <ResponsiveContainer width="100%" height={200} className="chart-reveal">
                    <AreaChart data={d.daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={52} tickFormatter={(v) => `Rs ${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => [`Rs ${Number(v).toLocaleString()}`, 'Sales']} labelStyle={{ fontSize: 11 }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                      <Area type="monotone" dataKey="sales" stroke="#6366f1" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="url(#salesGrad)" isAnimationActive animationDuration={1700} animationEasing="ease-out" />
                    </AreaChart>
                  </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 200 }} className="flex items-center justify-center">
                      <EmptyState title="No sales yet" subtitle="This will fill in once a voucher is sold." />
                    </div>
                  )}
                </GlassCard>
              </motion.div>

              {/* No. of Vouchers Sold */}
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
                <GlassCard>
                  <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
                    <Ticket size={18} /> No. of Vouchers Sold
                    <span className="ml-auto text-xs font-normal text-slate-400">Last 14 days</span>
                  </h3>
                  {dailyTrendHasActivity ? (
                  <ResponsiveContainer width="100%" height={200} className="chart-reveal">
                    <BarChart data={d.daily_trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={32} allowDecimals={false} />
                      <Tooltip formatter={(v: any) => [v, 'Vouchers']} labelStyle={{ fontSize: 11 }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                      <Bar dataKey="count" fill="url(#barGrad)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={1100} animationEasing="ease-out" />
                    </BarChart>
                  </ResponsiveContainer>
                  ) : (
                    <div style={{ height: 200 }} className="flex items-center justify-center">
                      <EmptyState title="No vouchers sold yet" subtitle="This will fill in once a voucher is sold." />
                    </div>
                  )}
                </GlassCard>
              </motion.div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4">
            {d.recent_customers && (
              <GlassCard>
                <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
                  <UserCheck size={18} /> Recent Customers
                </h3>
                {d.recent_customers.length === 0 ? (
                  <EmptyState>No customer logins yet.</EmptyState>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th>Voucher Code</th>
                          <th>Customer Username</th>
                          <th>Price</th>
                          <th>Activated At</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.recent_customers.map((v: any) => (
                          <tr key={v.code} className="hover:bg-secondary/20 transition-colors">
                            <td className="font-mono font-semibold">{v.code}</td>
                            <td className="font-semibold text-slate-700">{v.customer_username || '—'}</td>
                            <td className="font-bold text-primary">{rs(v.price)}</td>
                            <td className="text-xs text-muted-foreground">{v.activated_at ? date(v.activated_at) : (v.sold_at ? date(v.sold_at) : '—')}</td>
                            <td>
                              <Pill tone={statusPill[v.status] || 'secondary'}>
                                {v.status}
                              </Pill>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>
            )}
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      <Modal
        open={collectOpen}
        onClose={() => setCollectOpen(false)}
        title="Collect Payment"
        subtitle={
          canCollectCommission
            ? 'Record payment received from a downline user for pending GB allocation or commission due.'
            : 'Record payment received from a downline user for pending GB allocation.'
        }
        icon={<HandCoins size={20} />}
      >
        <div className="space-y-4">
          {/* Payment Type Switcher Tabs — commission is admin-only */}
          {canCollectCommission && (
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">Collection Type</label>
            <div className="flex bg-slate-100/80 p-1 rounded-2xl gap-1">
              <button
                type="button"
                onClick={() => {
                  setCollectType('gb')
                  const chosen = downlines.find((u) => u.id === +collectForm.user_id)
                  if (chosen) setCollectForm({ ...collectForm, amount: String(chosen.wallet_due) })
                }}
                className={`relative flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-colors ${
                  collectType === 'gb' ? 'text-[#003164]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {collectType === 'gb' && (
                  <motion.div
                    layoutId="collectTypePill"
                    className="absolute inset-0 bg-white rounded-xl shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">GB Wallet Pending Payment</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollectType('commission')
                  const chosen = downlines.find((u) => u.id === +collectForm.user_id)
                  if (chosen) setCollectForm({ ...collectForm, amount: String(chosen.commission_due) })
                }}
                className={`relative flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-colors ${
                  collectType === 'commission' ? 'text-[#003164]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {collectType === 'commission' && (
                  <motion.div
                    layoutId="collectTypePill"
                    className="absolute inset-0 bg-white rounded-xl shadow-sm"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
                <span className="relative z-10">Commission Payment</span>
              </button>
            </div>
          </div>
          )}

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">Select User</label>
            <CustomSelect
              className="w-full"
              placeholder="Choose a user..."
              searchable={downlines.length > 5}
              value={collectForm.user_id}
              onChange={(val) => {
                const uId = String(val)
                const chosen = downlines.find((u) => u.id === +uId)
                setCollectForm({
                  ...collectForm,
                  user_id: uId,
                  amount: chosen ? String(activeCollectType === 'commission' ? chosen.commission_due : chosen.wallet_due) : ''
                })
              }}
              options={downlines.map((dl) => ({
                value: String(dl.id),
                label: `${dl.name} (${dl.username})`,
                badge: (
                  <span className="text-[10px] font-bold shrink-0 flex items-center gap-1.5">
                    <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100/50">
                      GB Due: {rs(dl.wallet_due)}
                    </span>
                    {canCollectCommission && (
                      <span className="bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full border border-amber-100/50">
                        Comm: {rs(dl.commission_due)}
                      </span>
                    )}
                  </span>
                )
              }))}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">Amount (Rs.) — {activeCollectType === 'commission' ? 'Commission Settlement' : 'GB Pending Settlement'}</label>
            <input 
              className="input no-spinners" 
              type="text" 
              inputMode="decimal"
              placeholder="e.g. 5000" 
              value={collectForm.amount} 
              onChange={(e) => setCollectForm({ ...collectForm, amount: e.target.value })} 
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">Payment Method</label>
            <CustomSelect
              className="w-full"
              value={collectForm.payment_method}
              onChange={(val) => setCollectForm({ ...collectForm, payment_method: String(val) })}
              options={paymentMethods}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1.5">Payment Note</label>
            <input 
              className="input" 
              placeholder={activeCollectType === 'commission' ? 'e.g. Commission settlement' : 'e.g. Received via cash / bank transfer'}
              value={collectForm.note} 
              onChange={(e) => setCollectForm({ ...collectForm, note: e.target.value })} 
            />
          </div>

          {collectErr && <div className="pill danger w-full justify-center py-2">{collectErr}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost" onClick={() => setCollectOpen(false)}>Cancel</button>
            <motion.button 
              whileTap={{ scale: 0.95 }} 
              className="btn-primary" 
              disabled={collectBusy || !collectForm.user_id || !collectForm.amount} 
              onClick={handleCollectPayment}
            >
              {collectBusy ? 'Processing...' : `Collect ${activeCollectType === 'commission' ? 'Commission' : 'GB Payment'}`}
            </motion.button>
          </div>
        </div>
      </Modal>

      <FundModal
        open={quickFundOpen}
        onClose={() => setQuickFundOpen(false)}
        onSuccess={() => {
          api.get('/dashboard').then((r) => {
            setD(r.data.data)
            if (r.data.data.role === 'admin' || r.data.data.role === 'reseller') {
              fetchDownlines(r.data.data)
            }
          })
        }}
      />
    </div>
  )
}
