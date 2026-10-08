import { useState, useEffect } from 'react'
import { TrendingUp, Users2, RefreshCw, Search, FilterX, BarChart3, UserCheck, Calendar } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid
} from 'recharts'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rs, num } from '../lib/format'
import { Spinner, Combobox, SelectOption, DualDatePicker, PageTitle } from '../components/ui'

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
]

const formatDate = (d: Date) => d.toISOString().split('T')[0]

const getPresetDates = (preset: string) => {
  const now = new Date()

  if (preset === 'today') {
    const todayStr = formatDate(now)
    return { from: todayStr, to: todayStr }
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const yStr = formatDate(y)
    return { from: yStr, to: yStr }
  }
  if (preset === 'this_week') {
    const first = new Date(now)
    const day = first.getDay() || 7
    first.setDate(first.getDate() - day + 1)
    return { from: formatDate(first), to: formatDate(now) }
  }
  if (preset === 'this_month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: formatDate(first), to: formatDate(now) }
  }
  return { from: '', to: '' }
}

const DEFAULT_PRESET = 'today'
const DEFAULT_RANGE = getPresetDates(DEFAULT_PRESET)

interface SubscriberItem {
  id: number
  subscriber_name: string
  username: string
  customer_code: string | null
  plan_name: string
  revenue: number
  created_by: string
  created_at: string
}

interface RechargeItem {
  id: number
  subscriber_name: string
  username: string
  customer_code: string | null
  plan_name: string
  revenue: number
  recharged_by: string
  created_at: string
}

interface DailyTrendItem {
  date: string
  new_subscribers_count: number
  new_subscribers_revenue: number
  recharges_count: number
  recharges_revenue: number
}

interface PerformerItem {
  performer: string
  created_count: number
  created_revenue: number
  recharged_count: number
  recharged_revenue: number
  total_revenue: number
}

interface PppoeSalesSummaryData {
  summary: {
    total_revenue: number
    new_subscribers: { count: number; revenue: number }
    recharges: { count: number; revenue: number }
  }
  new_subscriber_plans: Array<{ plan_id: number; plan_name: string; count: number; revenue: number }>
  recharge_plans: Array<{ plan_id: number; plan_name: string; count: number; revenue: number }>
  new_subscribers?: SubscriberItem[]
  recharges?: RechargeItem[]
  daily_trend?: DailyTrendItem[]
  performer_breakdown?: PerformerItem[]
}

const CustomChartTooltip = ({ active, payload, label, isRevenue }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900/95 backdrop-blur-md text-white px-3.5 py-2.5 rounded-xl shadow-lg border border-slate-800 text-xs space-y-1">
        <p className="font-bold text-slate-300 border-b border-slate-700/60 pb-1 mb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 font-medium text-slate-300">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}:
            </span>
            <span className="font-extrabold text-white">
              {isRevenue ? rs(entry.value) : num(entry.value)}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function PppoeSalesSummary() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activePreset, setActivePreset] = useState<string>(DEFAULT_PRESET)
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(getPresetDates(DEFAULT_PRESET))
  const [resellerId, setResellerId] = useState<string>('')

  const [planSearch, setPlanSearch] = useState<string>('')
  const [tab, setTab] = useState<'new' | 'recharge'>('new')
  const [chartMode, setChartMode] = useState<'timeline' | 'performer'>('timeline')
  const [chartMetric, setChartMetric] = useState<'count' | 'revenue'>('count')

  const [resellerOptions, setResellerOptions] = useState<SelectOption[]>([
    { value: '', label: 'All Resellers' }
  ])

  const [data, setData] = useState<PppoeSalesSummaryData | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users', { params: { role: 'reseller', per_page: 200 } })
      .then((res: any) => {
        const list = Array.isArray(res.data?.data?.data)
          ? res.data.data.data
          : Array.isArray(res.data?.data)
          ? res.data.data
          : []
        setResellerOptions([
          { value: '', label: 'All Resellers' },
          ...list.map((u: any) => ({
            value: String(u.id),
            label: u.name,
            keywords: u.username,
          }))
        ])
      })
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    setLoading(true)
    const params: any = {}
    if (dateRange.from) params.from = dateRange.from
    if (dateRange.to) params.to = dateRange.to
    if (resellerId) params.reseller_id = resellerId

    api.get('/reports/pppoe-sales-summary', { params })
      .then((res: any) => {
        if (res.data?.success) setData(res.data.data)
      })
      .finally(() => setLoading(false))
  }, [dateRange, resellerId])

  const applyPreset = (presetKey: string) => {
    setActivePreset(presetKey)
    setDateRange(getPresetDates(presetKey))
  }

  const isFiltered =
    activePreset !== DEFAULT_PRESET ||
    dateRange.from !== DEFAULT_RANGE.from ||
    dateRange.to !== DEFAULT_RANGE.to ||
    resellerId !== '' ||
    planSearch !== ''

  const clearFilters = () => {
    setActivePreset(DEFAULT_PRESET)
    setDateRange(getPresetDates(DEFAULT_PRESET))
    setResellerId('')
    setPlanSearch('')
  }

  const summary = data?.summary
  const newSubscribers = data?.new_subscribers || []
  const recharges = data?.recharges || []
  const newPlans = data?.new_subscriber_plans || []
  const rechargePlans = data?.recharge_plans || []
  const dailyTrend = data?.daily_trend || []
  const performerBreakdown = data?.performer_breakdown || []

  // Filter detailed items or fall back to plan summary
  const hasDetailedNewSubs = newSubscribers.length > 0
  const hasDetailedRecharges = recharges.length > 0

  const filteredNewSubs = newSubscribers.filter((r) =>
    r.plan_name.toLowerCase().includes(planSearch.toLowerCase()) ||
    r.subscriber_name.toLowerCase().includes(planSearch.toLowerCase()) ||
    r.username.toLowerCase().includes(planSearch.toLowerCase()) ||
    (r.created_by && r.created_by.toLowerCase().includes(planSearch.toLowerCase()))
  )

  const filteredRecharges = recharges.filter((r) =>
    r.plan_name.toLowerCase().includes(planSearch.toLowerCase()) ||
    r.subscriber_name.toLowerCase().includes(planSearch.toLowerCase()) ||
    r.username.toLowerCase().includes(planSearch.toLowerCase()) ||
    (r.recharged_by && r.recharged_by.toLowerCase().includes(planSearch.toLowerCase()))
  )

  const filteredNewPlans = newPlans.filter((r) =>
    r.plan_name.toLowerCase().includes(planSearch.toLowerCase())
  )

  const filteredRechargePlans = rechargePlans.filter((r) =>
    r.plan_name.toLowerCase().includes(planSearch.toLowerCase())
  )

  const isGraphDataAvailable =
    chartMode === 'timeline'
      ? dailyTrend.some((d) => d.new_subscribers_count > 0 || d.recharges_count > 0 || d.new_subscribers_revenue > 0 || d.recharges_revenue > 0)
      : performerBreakdown.some((p) => p.total_revenue > 0 || p.created_count > 0 || p.recharged_count > 0)

  return (
    <div className="space-y-5">
      <PageTitle
        title="PPPoE Sales Summary"
        subtitle="Performance analytics, new subscriber registrations, and recharge revenue insights"
        icon={<TrendingUp size={22} className="text-emerald-500" />}
      />

      {/* Filter bar */}
      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-100/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-full">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => applyPreset(item.key)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                  activePreset === item.key
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={clearFilters}
            disabled={!isFiltered}
            title={isFiltered ? 'Reset every filter on this page' : 'No filters applied'}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <FilterX size={14} /> Clear Filter
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {isAdmin && (
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">Reseller</label>
              <Combobox
                value={resellerId}
                onChange={(val) => setResellerId(val)}
                options={resellerOptions}
                placeholder="All Resellers"
                className="w-full"
              />
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">From Date</label>
            <DualDatePicker
              label="From Date"
              value={dateRange.from}
              onChange={(val) => {
                setActivePreset('custom')
                setDateRange((prev) => ({ ...prev, from: val }))
              }}
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">To Date</label>
            <DualDatePicker
              label="To Date"
              value={dateRange.to}
              onChange={(val) => {
                setActivePreset('custom')
                setDateRange((prev) => ({ ...prev, to: val }))
              }}
            />
          </div>
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : (
        <>
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Total PPPoE Revenue</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary?.total_revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">New subscribers + recharges</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <TrendingUp size={18} />
              </div>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">New Subscribers</p>
                <p className="text-xl font-extrabold text-amber-600 mt-1">{rs(summary?.new_subscribers?.revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">New Registrations: {num(summary?.new_subscribers?.count || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <Users2 size={18} />
              </div>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Recharges</p>
                <p className="text-xl font-extrabold text-blue-600 mt-1">{rs(summary?.recharges?.revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Recharges: {num(summary?.recharges?.count || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <RefreshCw size={18} />
              </div>
            </div>
          </div>

          {/* Interactive Graph Card */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <BarChart3 size={18} />
                </div>
                <div>
                  <h3 className="font-extrabold text-primary text-base leading-snug">PPPoE Create & Recharge Graph</h3>
                  <p className="text-xs text-slate-400">Performance metrics and trends for PPPoE subscriber creations and recharges</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-slate-100/80 p-1 rounded-full text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setChartMode('timeline')}
                    className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                      chartMode === 'timeline'
                        ? 'bg-white text-slate-800 shadow-xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Calendar size={13} /> Timeline Trend
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('performer')}
                    className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 ${
                      chartMode === 'performer'
                        ? 'bg-white text-slate-800 shadow-xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <UserCheck size={13} /> By Performer
                  </button>
                </div>

                {/* Metric Toggle */}
                <div className="flex items-center bg-slate-100/80 p-1 rounded-full text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setChartMetric('count')}
                    className={`px-3.5 py-1.5 rounded-full transition-all ${
                      chartMetric === 'count'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Activity Count
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMetric('revenue')}
                    className={`px-3.5 py-1.5 rounded-full transition-all ${
                      chartMetric === 'revenue'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Revenue
                  </button>
                </div>
              </div>
            </div>

            {/* Chart Area */}
            {isGraphDataAvailable ? (
              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  {chartMode === 'timeline' ? (
                    chartMetric === 'revenue' ? (
                      <AreaChart data={dailyTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradNewSub" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="gradRecharge" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(val) => `NPR ${val}`} />
                        <Tooltip content={<CustomChartTooltip isRevenue={true} />} />
                        <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12, fontWeight: 700 }} />
                        <Area type="monotone" dataKey="new_subscribers_revenue" name="New Subscribers Revenue" stroke="#f59e0b" strokeWidth={2.5} fill="url(#gradNewSub)" />
                        <Area type="monotone" dataKey="recharges_revenue" name="Recharges Revenue" stroke="#2563eb" strokeWidth={2.5} fill="url(#gradRecharge)" />
                      </AreaChart>
                    ) : (
                      <BarChart data={dailyTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                        <Tooltip content={<CustomChartTooltip isRevenue={false} />} />
                        <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12, fontWeight: 700 }} />
                        <Bar dataKey="new_subscribers_count" name="New Subscribers" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="recharges_count" name="Recharges" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    )
                  ) : (
                    <BarChart data={performerBreakdown} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="performer" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        tickFormatter={(val) => (chartMetric === 'revenue' ? `NPR ${val}` : val)}
                      />
                      <Tooltip content={<CustomChartTooltip isRevenue={chartMetric === 'revenue'} />} />
                      <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12, fontWeight: 700 }} />
                      {chartMetric === 'revenue' ? (
                        <>
                          <Bar dataKey="created_revenue" name="Creation Revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="recharged_revenue" name="Recharge Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        </>
                      ) : (
                        <>
                          <Bar dataKey="created_count" name="Subscribers Created" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="recharged_count" name="Recharges Handled" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        </>
                      )}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="py-10 text-center border border-dashed border-slate-200 rounded-2xl">
                <p className="text-xs font-bold text-slate-500">No Graph Data Available</p>
                <p className="text-[11px] text-slate-400 mt-1">There are no creations or recharges logged for the selected period.</p>
              </div>
            )}
          </div>

          {/* Detailed Data Table Card */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="text-indigo-500 shrink-0">
                  <Users2 size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-primary text-base leading-snug">PPPoE Subscriber Summary</h3>
                  <p className="text-xs text-slate-400">New subscriber registrations and active renewals during the selected date range</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center bg-slate-100/70 p-1 rounded-full">
                  <button
                    type="button"
                    onClick={() => setTab('new')}
                    className={`px-4 py-1.5 text-xs font-extrabold rounded-full transition-all ${
                      tab === 'new'
                        ? 'bg-white text-[#002d5d] border border-[#002d5d]/30 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    New Subscribers ({num(summary?.new_subscribers?.count || 0)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('recharge')}
                    className={`px-4 py-1.5 text-xs font-extrabold rounded-full transition-all ${
                      tab === 'recharge'
                        ? 'bg-white text-[#002d5d] border border-[#002d5d]/30 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Recharges ({num(summary?.recharges?.count || 0)})
                  </button>
                </div>

                <div className="relative w-full sm:w-56">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search Plan or Subscriber..."
                    value={planSearch}
                    onChange={(e) => setPlanSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-full pl-8 pr-4 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Render Detailed Subscribers or Plan Summary */}
            {tab === 'new' ? (
              hasDetailedNewSubs ? (
                filteredNewSubs.length > 0 ? (
                  <div className="overflow-x-auto rounded-2xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-[#002d5d] text-white font-extrabold">
                          <th className="py-3 px-4 rounded-tl-xl">Subscriber Name</th>
                          <th className="py-3 px-4">Plan Name</th>
                          <th className="py-3 px-4">Created By</th>
                          <th className="py-3 px-4 text-right">Revenue</th>
                          <th className="py-3 px-4 text-right rounded-tr-xl">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredNewSubs.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50/50">
                            <td className="py-3.5 px-4 font-extrabold text-slate-800">
                              <div>
                                <p className="text-slate-900">{r.subscriber_name}</p>
                                <p className="text-[10px] text-slate-400 font-mono font-medium">{r.username}</p>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-bold text-slate-700">{r.plan_name}</td>
                            <td className="py-3.5 px-4">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200/60">
                                {r.created_by}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(r.revenue)}</td>
                            <td className="py-3.5 px-4 text-right font-medium text-slate-500">{r.created_at.substring(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-12 text-center space-y-1">
                    <p className="font-extrabold text-slate-800 text-sm">No New Subscribers Match Search</p>
                    <p className="text-xs text-slate-400 font-medium">No subscriber or plan matches your search term.</p>
                  </div>
                )
              ) : filteredNewPlans.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#002d5d] text-white font-extrabold">
                        <th className="py-3 px-4 rounded-tl-xl">Plan Name</th>
                        <th className="py-3 px-4 text-center">New Subscribers</th>
                        <th className="py-3 px-4 text-right rounded-tr-xl">Total Sales Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredNewPlans.map((r) => (
                        <tr key={r.plan_id} className="hover:bg-slate-50/50">
                          <td className="py-3.5 px-4 font-extrabold text-slate-800">{r.plan_name}</td>
                          <td className="py-3.5 px-4 text-center font-extrabold text-slate-800">{num(r.count)}</td>
                          <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(r.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center space-y-1">
                  <p className="font-extrabold text-slate-800 text-sm">No New Subscribers</p>
                  <p className="text-xs text-slate-400 font-medium">No new PPPoE subscribers registered in this date range.</p>
                </div>
              )
            ) : hasDetailedRecharges ? (
              filteredRecharges.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#002d5d] text-white font-extrabold">
                        <th className="py-3 px-4 rounded-tl-xl">Subscriber Name</th>
                        <th className="py-3 px-4">Plan Name</th>
                        <th className="py-3 px-4">Recharged By</th>
                        <th className="py-3 px-4 text-right">Revenue</th>
                        <th className="py-3 px-4 text-right rounded-tr-xl">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRecharges.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="py-3.5 px-4 font-extrabold text-slate-800">
                            <div>
                              <p className="text-slate-900">{r.subscriber_name}</p>
                              <p className="text-[10px] text-slate-400 font-mono font-medium">{r.username}</p>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-700">{r.plan_name}</td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                              {r.recharged_by}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(r.revenue)}</td>
                          <td className="py-3.5 px-4 text-right font-medium text-slate-500">{r.created_at.substring(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center space-y-1">
                  <p className="font-extrabold text-slate-800 text-sm">No PPPoE Recharges Match Search</p>
                  <p className="text-xs text-slate-400 font-medium">No subscriber or plan matches your search term.</p>
                </div>
              )
            ) : filteredRechargePlans.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-[#002d5d] text-white font-extrabold">
                      <th className="py-3 px-4 rounded-tl-xl">Plan Name</th>
                      <th className="py-3 px-4 text-center">Recharge Count</th>
                      <th className="py-3 px-4 text-right rounded-tr-xl">Recharge Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRechargePlans.map((r) => (
                      <tr key={r.plan_id} className="hover:bg-slate-50/50">
                        <td className="py-3.5 px-4 font-extrabold text-slate-800">{r.plan_name}</td>
                        <td className="py-3.5 px-4 text-center font-extrabold text-slate-800">{num(r.count)}</td>
                        <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center space-y-1">
                <p className="font-extrabold text-slate-800 text-sm">No PPPoE Recharges</p>
                <p className="text-xs text-slate-400 font-medium">No PPPoE recharges processed in this date range.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
