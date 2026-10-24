import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Users,
  Radio,
  Clock,
  AlertTriangle,
  UserCheck,
  UserX,
  Wallet,
  CreditCard,
  Calendar,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Receipt,
  FileText,
  Percent,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Phone,
  Mail,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { rs, num, date, datet } from '../lib/format'
import { Modal, GlassCard, Pill, Spinner, CustomSelect, SelectOption } from './ui'

interface ResellerSnapshotModalProps {
  open: boolean
  onClose: () => void
  resellerId: number | null
}

export function ResellerSnapshotModal({ open, onClose, resellerId }: ResellerSnapshotModalProps) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'financials' | 'recharges' | 'topups'>('overview')
  const [timePeriod, setTimePeriod] = useState<'all_time' | 'this_month' | 'today'>('all_time')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open || !resellerId) {
      setData(null)
      setErr('')
      return
    }

    setLoading(true)
    setErr('')
    api.get(`/resellers/${resellerId}/snapshot`)
      .then((res) => {
        if (res.data?.success && res.data?.data) {
          setData(res.data.data)
        } else {
          setErr('Unable to load reseller snapshot.')
        }
      })
      .catch((e) => {
        setErr(apiError(e))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, resellerId])

  if (!open) return null

  const r = data?.reseller
  const subs = data?.subscribers
  const fin = data?.financials
  const recharges = data?.recent_recharges || []
  const topups = data?.recent_topups || []

  const periodOptions: SelectOption[] = [
    { value: 'all_time', label: 'All Time' },
    { value: 'this_month', label: 'This Month' },
    { value: 'today', label: 'Today' },
  ]

  const topupAmount = timePeriod === 'all_time' ? fin?.topup?.all_time : timePeriod === 'this_month' ? fin?.topup?.this_month : fin?.topup?.today
  const rechargeAmount = timePeriod === 'all_time' ? fin?.recharge?.all_time : timePeriod === 'this_month' ? fin?.recharge?.this_month : fin?.recharge?.today

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reseller One-Sight Snapshot"
      subtitle={r ? `${r.name} (@${r.username})` : 'Comprehensive Reseller Performance and Financial Overview'}
      icon={<Users size={22} className="text-primary" />}
      widthClassName="max-w-[98vw] w-[98vw]"
      bodyClassName="overflow-y-auto max-h-[calc(92vh-7rem)]"
    >
      <div className="space-y-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Spinner />
            <p className="text-xs font-medium text-slate-500">Loading Reseller Snapshot...</p>
          </div>
        ) : err ? (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
            {err}
          </div>
        ) : data ? (
          <>
            {/* Reseller Header Card */}
            <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 text-primary flex items-center justify-center font-bold text-lg border border-primary/20 shadow-sm shrink-0">
                  {r?.name?.charAt(0)?.toUpperCase() || 'R'}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-extrabold text-slate-800 dark:text-white text-base">{r?.name}</h3>
                    <span className="font-mono text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                      @{r?.username}
                    </span>
                    <Pill tone={r?.status === 'active' ? 'success' : 'danger'}>
                      {r?.status === 'active' ? 'Active Reseller' : 'Disabled'}
                    </Pill>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
                    {r?.phone && (
                      <span className="flex items-center gap-1">
                        <Phone size={12} className="text-slate-400" /> {r.phone}
                      </span>
                    )}
                    {r?.email && (
                      <span className="flex items-center gap-1">
                        <Mail size={12} className="text-slate-400" /> {r.email}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400">
                      <Percent size={12} /> Commission: {r?.commission_percent}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Balances */}
              <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
                <div className="text-right px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shadow-sm">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Remaining Balance</p>
                  <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{rs(r?.wallet_balance)}</p>
                </div>
                <div className="text-right px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shadow-sm">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Outstanding Due</p>
                  <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400">{rs(r?.total_due)}</p>
                </div>
              </div>
            </div>

            {/* Navigation Tab Bar */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'overview'
                    ? 'bg-white dark:bg-slate-900 text-primary shadow-sm font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Layers size={14} /> Overview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('financials')}
                className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'financials'
                    ? 'bg-white dark:bg-slate-900 text-primary shadow-sm font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <TrendingUp size={14} /> Financial Summary
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('recharges')}
                className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'recharges'
                    ? 'bg-white dark:bg-slate-900 text-primary shadow-sm font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Receipt size={14} /> Recent Sales ({recharges.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('topups')}
                className={`flex-1 py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'topups'
                    ? 'bg-white dark:bg-slate-900 text-primary shadow-sm font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <Wallet size={14} /> Wallet Top-Ups ({topups.length})
              </button>
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {/* Subscriber Metrics Grid */}
                <div>
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
                    <Users size={14} className="text-primary" /> Subscriber Overview
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Users</p>
                      <p className="text-xl font-extrabold text-slate-800 dark:text-white mt-1 tabular-nums">
                        {num(subs?.total || 0)}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Assigned base</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/60 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Active Users</p>
                        <UserCheck size={13} className="text-emerald-600" />
                      </div>
                      <p className="text-xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-1 tabular-nums">
                        {num(subs?.active || 0)}
                      </p>
                      <p className="text-[10px] text-emerald-600/80 mt-0.5">Valid accounts</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/60 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-rose-700 dark:text-rose-300">Expired Users</p>
                        <UserX size={13} className="text-rose-600" />
                      </div>
                      <p className="text-xl font-extrabold text-rose-700 dark:text-rose-300 mt-1 tabular-nums">
                        {num(subs?.expired || 0)}
                      </p>
                      <p className="text-[10px] text-rose-600/80 mt-0.5">Term lapsed</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-cyan-50/60 dark:bg-cyan-950/30 border border-cyan-200/60 dark:border-cyan-800/60 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-cyan-700 dark:text-cyan-300">Online Now</p>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                      </div>
                      <p className="text-xl font-extrabold text-cyan-700 dark:text-cyan-300 mt-1 tabular-nums">
                        {num(subs?.online || 0)}
                      </p>
                      <p className="text-[10px] text-cyan-600/80 mt-0.5">Live RADIUS</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/60 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Expiring (7D)</p>
                        <AlertTriangle size={13} className="text-amber-600" />
                      </div>
                      <p className="text-xl font-extrabold text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
                        {num(subs?.expiring_soon_7d || 0)}
                      </p>
                      <p className="text-[10px] text-amber-600/80 mt-0.5">Needs renewal</p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-800/60 shadow-sm">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-purple-700 dark:text-purple-300">New This Month</p>
                        <ArrowUpRight size={13} className="text-purple-600" />
                      </div>
                      <p className="text-xl font-extrabold text-purple-700 dark:text-purple-300 mt-1 tabular-nums">
                        {num(subs?.new_this_month || 0)}
                      </p>
                      <p className="text-[10px] text-purple-600/80 mt-0.5">Growth metric</p>
                    </div>
                  </div>
                </div>

                {/* Financial Highlights */}
                <div>
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
                    <TrendingUp size={14} className="text-emerald-500" /> Financial Overview
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Top-Up</span>
                        <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                          <Wallet size={14} />
                        </div>
                      </div>
                      <p className="text-lg font-black text-slate-800 dark:text-white tabular-nums">
                        {rs(fin?.topup?.all_time || 0)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        This Month: <span className="font-bold text-slate-700 dark:text-slate-300">{rs(fin?.topup?.this_month || 0)}</span>
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Recharges</span>
                        <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
                          <Receipt size={14} />
                        </div>
                      </div>
                      <p className="text-lg font-black text-slate-800 dark:text-white tabular-nums">
                        {rs(fin?.recharge?.all_time || 0)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        This Month: <span className="font-bold text-slate-700 dark:text-slate-300">{rs(fin?.recharge?.this_month || 0)}</span>
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Remaining Balance</span>
                        <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                          <CreditCard size={14} />
                        </div>
                      </div>
                      <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {rs(fin?.wallet_balance || 0)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Current Available Balance
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Outstanding Due</span>
                        <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                          <AlertTriangle size={14} />
                        </div>
                      </div>
                      <p className="text-lg font-black text-rose-600 dark:text-rose-400 tabular-nums">
                        {rs(fin?.total_due || 0)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Due: {rs(fin?.wallet_due || 0)} · Comm: {rs(fin?.commission_due || 0)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Plan Distribution */}
                {subs?.plans_breakdown && subs.plans_breakdown.length > 0 && (
                  <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                      <Layers size={14} className="text-primary" /> Active Plan Distribution
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {subs.plans_breakdown.map((p: any, idx: number) => {
                        const pct = subs.total > 0 ? Math.round((p.count / subs.total) * 100) : 0
                        return (
                          <div key={idx} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                              <span className="truncate mr-2">{p.plan_name}</span>
                              <span className="text-primary tabular-nums shrink-0">{p.count} ({pct}%)</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                              <div
                                className="bg-primary h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: FINANCIAL SUMMARY */}
            {activeTab === 'financials' && (
              <div className="space-y-4">
                {/* Timeframe Filter Bar */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Select Timeframe:</span>
                  </div>
                  <div className="w-48">
                    <CustomSelect
                      value={timePeriod}
                      onChange={(v) => setTimePeriod(v as any)}
                      options={periodOptions}
                      className="w-full text-xs"
                    />
                  </div>
                </div>

                {/* Big Metric Comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Top-up Box */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-slate-900 border border-emerald-100 dark:border-emerald-800/40 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Top-Up Amount</span>
                      <Wallet size={18} className="text-emerald-600" />
                    </div>
                    <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-2 tabular-nums">
                      {rs(topupAmount || 0)}
                    </p>
                    <div className="mt-3 pt-3 border-t border-emerald-100/60 dark:border-emerald-800/40 text-xs text-slate-500 flex justify-between">
                      <span>Total Loads: {fin?.topup?.count || 0} times</span>
                      <span>Today: {rs(fin?.topup?.today || 0)}</span>
                    </div>
                  </div>

                  {/* Recharge Box */}
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-50/50 to-white dark:from-purple-950/20 dark:to-slate-900 border border-purple-100 dark:border-purple-800/40 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-purple-800 dark:text-purple-300">Customer Recharges</span>
                      <Receipt size={18} className="text-purple-600" />
                    </div>
                    <p className="text-2xl font-black text-purple-700 dark:text-purple-300 mt-2 tabular-nums">
                      {rs(rechargeAmount || 0)}
                    </p>
                    <div className="mt-3 pt-3 border-t border-purple-100/60 dark:border-purple-800/40 text-xs text-slate-500 flex justify-between">
                      <span>Total Recharges: {fin?.recharge?.count || 0}</span>
                      <span>Today: {rs(fin?.recharge?.today || 0)}</span>
                    </div>
                  </div>
                </div>

                {/* Revenue & Commission Split Details */}
                <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                    <Percent size={14} className="text-primary" /> Revenue And Commission Breakdown
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Recharges Processed</p>
                      <p className="text-base font-extrabold text-slate-800 dark:text-white mt-1 tabular-nums">
                        {rs(fin?.recharge?.all_time || 0)}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Admin Share (Net Due)</p>
                      <p className="text-base font-extrabold text-primary mt-1 tabular-nums">
                        {rs(fin?.recharge?.admin_share_all_time || 0)}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Reseller Commission Share</p>
                      <p className="text-base font-extrabold text-purple-600 dark:text-purple-400 mt-1 tabular-nums">
                        {rs(fin?.recharge?.reseller_share_all_time || 0)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 p-3.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/60 flex items-center justify-between flex-wrap gap-2 text-xs">
                    <div>
                      <span className="font-bold text-rose-800 dark:text-rose-300">Total Outstanding Baki (Dues): </span>
                      <span className="text-slate-600 dark:text-slate-400">
                        Wallet Due: {rs(fin?.wallet_due || 0)} + Commission Due: {rs(fin?.commission_due || 0)}
                      </span>
                    </div>
                    <span className="text-base font-black text-rose-700 dark:text-rose-300 tabular-nums">
                      {rs(fin?.total_due || 0)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: RECENT RECHARGES */}
            {activeTab === 'recharges' && (
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Receipt size={14} className="text-primary" /> Recent Sales &amp; Renewals
                  </h4>
                  <span className="text-[11px] text-slate-400 font-medium">Last 15 records</span>
                </div>

                {recharges.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No sales found for this reseller.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-slate-400 font-bold">
                          <th className="py-2.5 px-3">Reference</th>
                          <th className="py-2.5 px-3">Subscriber</th>
                          <th className="py-2.5 px-3">Plan</th>
                          <th className="py-2.5 px-3">Validity</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3 text-right">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                        {recharges.map((rc: any) => (
                          <tr key={rc.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                              {rc.reference}
                            <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${rc.type === 'new' ? 'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/60' : 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60'}`}>
                              {rc.type === 'new' ? 'New Connection' : 'Renewal'}
                            </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-semibold text-slate-800 dark:text-slate-200 block">{rc.customer_name || '—'}</span>
                              <span className="text-[10px] text-slate-400 font-mono">@{rc.customer_username}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold border border-purple-100/60 dark:border-purple-800/60">
                                {rc.plan_name}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                              {rc.validity_days} Days
                            </td>
                            <td className="py-2.5 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {rs(rc.price)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-400 text-[11px] whitespace-nowrap">
                              {rc.created_at ? datet(rc.created_at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: WALLET TOP-UPS */}
            {activeTab === 'topups' && (
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Wallet size={14} className="text-emerald-500" /> Wallet Funding History
                  </h4>
                  <span className="text-[11px] text-slate-400 font-medium">Last 15 records</span>
                </div>

                {topups.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No wallet load history found for this reseller.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-slate-400 font-bold">
                          <th className="py-2.5 px-3">Transaction ID</th>
                          <th className="py-2.5 px-3">Loaded By</th>
                          <th className="py-2.5 px-3">Note</th>
                          <th className="py-2.5 px-3 text-right">Loaded Amount</th>
                          <th className="py-2.5 px-3 text-right">Balance After</th>
                          <th className="py-2.5 px-3 text-right">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                        {topups.map((t: any) => (
                          <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                              TX-{t.id}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                              {t.from_username}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 italic max-w-xs truncate">
                              {t.note || 'Wallet load'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              +{rs(t.amount)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                              {rs(t.balance_after)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-400 text-[11px] whitespace-nowrap">
                              {t.created_at ? datet(t.created_at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}

        <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all"
          >
            Close Snapshot
          </button>
        </div>
      </div>
    </Modal>
  )
}
