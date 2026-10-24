import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
  ArrowLeft,
  LayoutGrid,
  PieChart as PieChartIcon,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { rs, num, date, datet } from '../lib/format'
import { PageTitle, GlassCard, Pill, Spinner, CustomSelect, SelectOption } from '../components/ui'
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell } from 'recharts'

function DailySalesTrendCard({ data }: { data: any[] }) {
  if (!data || data.length === 0) return null

  return (
    <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <TrendingUp size={20} className="text-primary dark:text-sky-400 stroke-[2.5]" />
          <h4 className="text-base font-extrabold text-slate-800 dark:text-white">Daily Sales Trend</h4>
        </div>
        <span className="text-xs font-semibold text-slate-400">Last 14 days</span>
      </div>

      <div className="h-64 sm:h-72 w-full mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 15, right: 15, left: -5, bottom: 5 }}>
            <defs>
              <linearGradient id="purpleSalesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.32} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="rgba(148, 163, 184, 0.15)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => (v ? v.slice(5) : '')}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.25)' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(val) => `Rs ${val >= 1000 ? `${Math.round(val / 1000)}k` : val}`}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white dark:bg-slate-800 p-3 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 text-xs space-y-1.5">
                      <p className="font-bold text-slate-700 dark:text-slate-200">{label ? date(String(label)) : ''}</p>
                      <div className="flex items-center justify-between gap-4 text-purple-600 dark:text-purple-400 font-semibold">
                        <span>PPPoE New Sales:</span>
                        <span className="tabular-nums font-extrabold">{rs(Number(payload.find((p: any) => p.dataKey === 'pppoe_new_sales')?.value || 0))}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <span>PPPoE Renewal Sales:</span>
                        <span className="tabular-nums font-extrabold">{rs(Number(payload.find((p: any) => p.dataKey === 'pppoe_recharge_sales')?.value || 0))}</span>
                      </div>
                    </div>
                  )
                }
                return null
              }}
            />
            <Area
              type="monotone"
              dataKey="pppoe_recharge_sales"
              stroke="#10b981"
              strokeWidth={2.5}
              fillOpacity={0}
              fill="none"
              dot={false}
              activeDot={{ r: 5, fill: '#10b981' }}
              name="PPPoE Renewal Sales"
            />
            <Area
              type="monotone"
              dataKey="pppoe_new_sales"
              stroke="#8b5cf6"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#purpleSalesGrad)"
              dot={false}
              activeDot={{ r: 6, fill: '#8b5cf6', stroke: '#fff', strokeWidth: 2 }}
              name="PPPoE New Sales"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-6 pt-3 pb-1 text-xs font-bold">
        <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
          <span className="flex items-center">
            <span className="w-2.5 h-0.5 bg-purple-500 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full border-2 border-purple-500 bg-white dark:bg-slate-900 inline-block -mx-0.5" />
            <span className="w-2.5 h-0.5 bg-purple-500 inline-block" />
          </span>
          <span>PPPoE New Sales</span>
        </div>
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <span className="flex items-center">
            <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full border-2 border-emerald-500 bg-white dark:bg-slate-900 inline-block -mx-0.5" />
            <span className="w-2.5 h-0.5 bg-emerald-500 inline-block" />
          </span>
          <span>PPPoE Renewal Sales</span>
        </div>
      </div>
    </div>
  )
}

function DailyActivityCard({ data }: { data: any[] }) {
  return (
    <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <TrendingUp size={20} className="text-emerald-500 stroke-[2.5]" />
          <h4 className="text-base font-extrabold text-slate-800 dark:text-white">Daily Activity</h4>
        </div>
        <span className="text-xs font-semibold text-slate-400">Last 14 days</span>
      </div>

      {data && data.length > 0 ? (
        <div className="h-64 sm:h-72 w-full mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 15, right: 15, left: -20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.2)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => v.slice(5)}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.25)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(label) => `Date: ${date(String(label))}`}
                formatter={(val: any, name: any) => [
                  val,
                  name === 'new_subscribers' ? 'New Subscribers' : name === 'expired' ? 'Expired' : 'Renewals'
                ]}
                contentStyle={{
                  borderRadius: '16px',
                  border: '1px solid #e2e8f0',
                  fontSize: '12px',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                formatter={(value) => (
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {value === 'new_subscribers' ? 'New Subscribers' : value === 'expired' ? 'Expired' : 'Renewals'}
                  </span>
                )}
              />
              <Bar
                dataKey="new_subscribers"
                fill="#8b5cf6"
                radius={[6, 6, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                dataKey="expired"
                fill="#ef4444"
                radius={[6, 6, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                dataKey="recharges"
                fill="#10b981"
                radius={[6, 6, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="py-16 text-center text-xs text-slate-400">
          No daily activity records found for the last 14 days.
        </div>
      )}

      <div className="flex items-center justify-center gap-6 pt-3 pb-1 text-xs font-bold text-slate-400">
        <span>New, Expired & Renewed</span>
      </div>
    </div>
  )
}

export default function ResellerSnapshot() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const resellerId = id ? parseInt(id, 10) : null

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'financials' | 'recharges' | 'topups'>('overview')
  const [timePeriod, setTimePeriod] = useState<'all_time' | 'this_month' | 'today'>('all_time')
  const [planViewTab, setPlanViewTab] = useState<'grid' | 'chart'>('grid')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!resellerId) {
      setErr('No reseller specified.')
      setLoading(false)
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
  }, [resellerId])

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
    <div className="space-y-5 pb-12">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
          <Spinner />
          <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Loading Reseller Snapshot...</p>
        </div>
      ) : err ? (
        <div className="p-6 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{err}</span>
            <button
              onClick={() => navigate('/resellers')}
              className="text-xs font-bold underline hover:opacity-80 ml-4"
            >
              Return to Resellers
            </button>
          </div>
        </div>
      ) : data ? (
        <>
          {/* Reseller Header Identity Card */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/15 to-purple-500/15 text-primary dark:text-sky-400 flex items-center justify-center font-bold text-xl border border-primary/20 shadow-sm shrink-0">
                {r?.name?.charAt(0)?.toUpperCase() || 'R'}
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="font-extrabold text-slate-800 dark:text-white text-xl leading-tight">{r?.name}</h2>
                  <span className="font-mono text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                    @{r?.username}
                  </span>
                  <Pill tone={r?.status === 'active' ? 'success' : 'danger'}>
                    {r?.status === 'active' ? 'Active Reseller' : 'Disabled'}
                  </Pill>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex-wrap">
                  {r?.phone && (
                    <span className="flex items-center gap-1.5">
                      <Phone size={13} className="text-slate-400" /> {r.phone}
                    </span>
                  )}
                  {r?.email && (
                    <span className="flex items-center gap-1.5">
                      <Mail size={13} className="text-slate-400" /> {r.email}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 font-bold text-purple-600 dark:text-purple-400">
                    <Percent size={13} /> Commission: {r?.commission_percent}%
                  </span>
                </div>
              </div>
            </div>

            {/* Back Button */}
            <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
              <motion.button
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => navigate('/resellers')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold transition-all shadow-xs"
              >
                <ArrowLeft size={16} /> Back to Resellers
              </motion.button>
            </div>
          </div>

          {/* Navigation Tab Bar */}
          <div className="flex items-center gap-2 p-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-2xl text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`flex-1 py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 ${
                activeTab === 'overview'
                  ? 'bg-white dark:bg-slate-900 text-primary dark:text-white shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users size={15} /> Subscriber Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('financials')}
              className={`flex-1 py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 ${
                activeTab === 'financials'
                  ? 'bg-white dark:bg-slate-900 text-primary dark:text-white shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <TrendingUp size={15} /> Financial Summary
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('recharges')}
              className={`flex-1 py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 ${
                activeTab === 'recharges'
                  ? 'bg-white dark:bg-slate-900 text-primary dark:text-white shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Receipt size={15} /> Recent Sales ({recharges.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('topups')}
              className={`flex-1 py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 ${
                activeTab === 'topups'
                  ? 'bg-white dark:bg-slate-900 text-primary dark:text-white shadow-sm font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Wallet size={15} /> Wallet Top-Ups ({topups.length})
            </button>
          </div>

          {/* TAB 1: SUBSCRIBER OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Subscriber Overview */}
              <div>
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                  <Users size={16} className="text-primary" /> Subscriber Overview
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Users</p>
                    <p className="text-2xl font-black text-slate-800 dark:text-white mt-1 tabular-nums">
                      {num(subs?.total || 0)}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">Assigned base</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/25 border border-emerald-100 dark:border-emerald-800/50 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Active Users</p>
                      <UserCheck size={14} className="text-emerald-600" />
                    </div>
                    <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-1 tabular-nums">
                      {num(subs?.active || 0)}
                    </p>
                    <p className="text-[11px] text-emerald-600/80 mt-1">Valid accounts</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-rose-50/50 dark:bg-rose-950/25 border border-rose-100 dark:border-rose-800/50 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-rose-800 dark:text-rose-300">Expired Users</p>
                      <UserX size={14} className="text-rose-600" />
                    </div>
                    <p className="text-2xl font-black text-rose-700 dark:text-rose-300 mt-1 tabular-nums">
                      {num(subs?.expired || 0)}
                    </p>
                    <p className="text-[11px] text-rose-600/80 mt-1">Term lapsed</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-cyan-50/50 dark:bg-cyan-950/25 border border-cyan-100 dark:border-cyan-800/50 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-cyan-800 dark:text-cyan-300">Online Now</p>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    </div>
                    <p className="text-2xl font-black text-cyan-700 dark:text-cyan-300 mt-1 tabular-nums">
                      {num(subs?.online || 0)}
                    </p>
                    <p className="text-[11px] text-cyan-600/80 mt-1">Live RADIUS</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/25 border border-amber-100 dark:border-amber-800/50 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Expiring (7D)</p>
                      <AlertTriangle size={14} className="text-amber-600" />
                    </div>
                    <p className="text-2xl font-black text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
                      {num(subs?.expiring_soon_7d || 0)}
                    </p>
                    <p className="text-[11px] text-amber-600/80 mt-1">Needs renewal</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/25 border border-purple-100 dark:border-purple-800/50 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-purple-800 dark:text-purple-300">New This Month</p>
                      <ArrowUpRight size={14} className="text-purple-600" />
                    </div>
                    <p className="text-2xl font-black text-purple-700 dark:text-purple-300 mt-1 tabular-nums">
                      {num(subs?.new_this_month || 0)}
                    </p>
                    <p className="text-[11px] text-purple-600/80 mt-1">Growth metric</p>
                  </div>
                </div>
              </div>

              {/* Daily Activity & Active Plan Distribution (Side by Side in Same Row) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <DailyActivityCard data={subs?.daily_trend} />

                {/* Active Plan Distribution With Tabs (Grid View vs Visual Chart) */}
                {subs?.plans_breakdown && subs.plans_breakdown.length > 0 ? (
                  <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div className="flex items-center gap-2.5">
                          <Layers size={18} className="text-primary dark:text-sky-400" />
                          <div>
                            <h4 className="text-base font-extrabold text-slate-800 dark:text-white">Active Plan Distribution</h4>
                            <p className="text-xs text-slate-400">Total Assigned: {num(subs?.total || 0)}</p>
                          </div>
                        </div>

                        {/* View Switcher Tabs */}
                        <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold">
                          <button
                            type="button"
                            onClick={() => setPlanViewTab('grid')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                              planViewTab === 'grid'
                                ? 'bg-white dark:bg-slate-700 text-primary dark:text-white shadow-xs'
                                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <LayoutGrid size={13} /> Grid View
                          </button>
                          <button
                            type="button"
                            onClick={() => setPlanViewTab('chart')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                              planViewTab === 'chart'
                                ? 'bg-white dark:bg-slate-700 text-primary dark:text-white shadow-xs'
                                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <PieChartIcon size={13} /> Visual Chart
                          </button>
                        </div>
                      </div>

                      {/* TAB 1: Grid View */}
                      {planViewTab === 'grid' && (
                        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                          {subs.plans_breakdown.map((p: any, idx: number) => {
                            const pct = subs.total > 0 ? Math.round((p.count / subs.total) * 100) : 0
                            return (
                              <div key={idx} className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200">
                                  <span className="truncate mr-2">{p.plan_name}</span>
                                  <span className="text-primary dark:text-sky-400 tabular-nums shrink-0">{p.count} ({pct}%)</span>
                                </div>
                                <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                                  <div
                                    className="bg-primary dark:bg-sky-500 h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* TAB 2: Visual Chart */}
                      {planViewTab === 'chart' && (
                        <div className="h-64 sm:h-72 w-full flex items-center justify-center">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Tooltip
                                formatter={(value: any, name: any) => [`${value} subscribers`, String(name)]}
                                contentStyle={{
                                  borderRadius: '16px',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '12px',
                                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                                }}
                              />
                              <Pie
                                data={subs.plans_breakdown}
                                dataKey="count"
                                nameKey="plan_name"
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={80}
                                paddingAngle={3}
                              >
                                {subs.plans_breakdown.map((_: any, index: number) => {
                                  const colors = ['#0284c7', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#6366f1'];
                                  return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                                })}
                              </Pie>
                              <Legend
                                verticalAlign="bottom"
                                align="center"
                                iconType="circle"
                                formatter={(value) => (
                                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    {value}
                                  </span>
                                )}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-center gap-6 pt-3 pb-1 text-xs font-bold text-slate-400">
                      <span>Package Ratio & Market Penetration</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-center text-xs text-slate-400">
                    No active plan breakdown records found.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: FINANCIAL SUMMARY */}
          {activeTab === 'financials' && (
            <div className="space-y-5">
              {/* Timeframe Filter */}
              <div className="flex items-center justify-between p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-2">
                  <Calendar size={18} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Select Timeframe:</span>
                </div>
                <div className="w-52">
                  <CustomSelect
                    value={timePeriod}
                    onChange={(v) => setTimePeriod(v as any)}
                    options={periodOptions}
                    className="w-full text-xs"
                  />
                </div>
              </div>

              {/* Financial Balance & Activity Metric Boxes (Top-Up and Recharges in first columns) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Top-Up Amount */}
                <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Top-Up Amount</span>
                      <CreditCard size={18} className="text-primary dark:text-sky-400" />
                    </div>
                    <p className="text-2xl font-black text-slate-800 dark:text-white mt-2.5 tabular-nums">
                      {rs(topupAmount || 0)}
                    </p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 flex justify-between font-medium">
                    <span>Loads: {fin?.topup?.count || 0}</span>
                    <span>Today: {rs(fin?.topup?.today || 0)}</span>
                  </div>
                </div>

                {/* 2. Customer Recharges */}
                <div className="p-5 rounded-3xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800/40 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-purple-800 dark:text-purple-300">Customer Recharges</span>
                      <Receipt size={18} className="text-purple-600" />
                    </div>
                    <p className="text-2xl font-black text-purple-700 dark:text-purple-300 mt-2.5 tabular-nums">
                      {rs(rechargeAmount || 0)}
                    </p>
                  </div>
                  <div className="mt-2 pt-2 border-t border-purple-100/60 dark:border-purple-800/40 text-[11px] text-slate-400 flex justify-between font-medium">
                    <span>Total: {fin?.recharge?.count || 0}</span>
                    <span>Today: {rs(fin?.recharge?.today || 0)}</span>
                  </div>
                </div>

                {/* 3. Remaining Balance */}
                <div className="p-5 rounded-3xl bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-100 dark:border-emerald-800/40 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Remaining Balance</span>
                      <Wallet size={18} className="text-emerald-600" />
                    </div>
                    <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300 mt-2.5 tabular-nums">
                      {rs(r?.wallet_balance)}
                    </p>
                  </div>
                  <p className="text-[11px] text-emerald-600/80 mt-2 font-medium">Prepaid wallet balance</p>
                </div>

                {/* 4. Outstanding Due */}
                <div className="p-5 rounded-3xl bg-rose-50/60 dark:bg-rose-950/25 border border-rose-100 dark:border-rose-800/40 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-800 dark:text-rose-300">Outstanding Due</span>
                      <AlertTriangle size={18} className="text-rose-600" />
                    </div>
                    <p className="text-2xl font-black text-rose-700 dark:text-rose-300 mt-2.5 tabular-nums">
                      {rs(r?.total_due)}
                    </p>
                  </div>
                  <p className="text-[11px] text-rose-600/80 mt-2 font-medium">Wallet & commission due</p>
                </div>
              </div>

              {/* Row 2: Daily Sales Trend & Revenue Breakdown Side by Side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <DailySalesTrendCard data={subs?.daily_trend} />

                {/* Revenue And Commission Breakdown Card */}
                <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                  <div>
                    <h4 className="text-base font-extrabold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                      <Percent size={18} className="text-primary dark:text-sky-400" /> Revenue And Commission Breakdown
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Total Recharges Processed</p>
                        <p className="text-lg font-black text-slate-800 dark:text-white mt-1.5 tabular-nums">
                          {rs(fin?.recharge?.all_time || 0)}
                        </p>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Admin Share (Net Due)</p>
                        <p className="text-lg font-black text-primary dark:text-sky-400 mt-1.5 tabular-nums">
                          {rs(fin?.recharge?.admin_share_all_time || 0)}
                        </p>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Reseller Commission Share</p>
                        <p className="text-lg font-black text-purple-600 dark:text-purple-400 mt-1.5 tabular-nums">
                          {rs(fin?.recharge?.reseller_share_all_time || 0)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 p-4 rounded-2xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/60 flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div>
                        <span className="font-bold text-rose-800 dark:text-rose-300">Total Outstanding Baki (Dues): </span>
                        <span className="text-slate-600 dark:text-slate-400 ml-1">
                          Wallet: {rs(fin?.wallet_due || 0)} + Commission: {rs(fin?.commission_due || 0)}
                        </span>
                      </div>
                      <span className="text-lg font-black text-rose-700 dark:text-rose-300 tabular-nums">
                        {rs(fin?.total_due || 0)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-6 pt-3 pb-1 text-xs font-bold text-slate-400">
                    <span>Split Formula: Total Price = Admin Share + Reseller Share</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: RECENT RECHARGES */}
          {activeTab === 'recharges' && (
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Receipt size={16} className="text-primary" /> Recent Sales &amp; Renewals
                </h4>
                <span className="text-xs text-slate-400 font-medium">Last 15 records</span>
              </div>

              {recharges.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">No sales found for this reseller.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-slate-400 font-bold">
                        <th className="py-3 px-3">Reference</th>
                        <th className="py-3 px-3">Subscriber</th>
                        <th className="py-3 px-3">Plan</th>
                        <th className="py-3 px-3">Validity</th>
                        <th className="py-3 px-3 text-right">Amount</th>
                        <th className="py-3 px-3 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                      {recharges.map((rc: any) => (
                        <tr key={rc.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                            {rc.reference}
                            <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${rc.type === 'new' ? 'bg-violet-50 text-violet-700 border-violet-100 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/60' : 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60'}`}>
                              {rc.type === 'new' ? 'New Connection' : 'Renewal'}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block">{rc.customer_name || '—'}</span>
                            <span className="text-[10px] text-slate-400 font-mono">@{rc.customer_username}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-bold border border-purple-100/60 dark:border-purple-800/60">
                              {rc.plan_name}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                            {rc.validity_days} Days
                          </td>
                          <td className="py-3 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {rs(rc.price)}
                          </td>
                          <td className="py-3 px-3 text-right text-slate-400 text-[11px] whitespace-nowrap">
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
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                  <Wallet size={16} className="text-emerald-500" /> Wallet Funding History
                </h4>
                <span className="text-xs text-slate-400 font-medium">Last 15 records</span>
              </div>

              {topups.length === 0 ? (
                <p className="text-xs text-slate-400 py-8 text-center">No wallet load history found for this reseller.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-left text-slate-400 font-bold">
                        <th className="py-3 px-3">Transaction ID</th>
                        <th className="py-3 px-3">Loaded By</th>
                        <th className="py-3 px-3">Note</th>
                        <th className="py-3 px-3 text-right">Loaded Amount</th>
                        <th className="py-3 px-3 text-right">Balance After</th>
                        <th className="py-3 px-3 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/60 dark:divide-slate-800/60">
                      {topups.map((t: any) => (
                        <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                            TX-{t.id}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-700 dark:text-slate-300">
                            {t.from_username}
                          </td>
                          <td className="py-3 px-3 text-slate-500 italic max-w-xs truncate">
                            {t.note || 'Wallet load'}
                          </td>
                          <td className="py-3 px-3 text-right font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            +{rs(t.amount)}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                            {rs(t.balance_after)}
                          </td>
                          <td className="py-3 px-3 text-right text-slate-400 text-[11px] whitespace-nowrap">
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
    </div>
  )
}
