import { Fragment, useEffect, useState } from 'react'
import { Percent, Wallet, Landmark, FilterX, ChevronRight, ChevronDown } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
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
    const t = formatDate(now)
    return { from: t, to: t }
  }
  if (preset === 'yesterday') {
    const y = new Date(now)
    y.setDate(y.getDate() - 1)
    const s = formatDate(y)
    return { from: s, to: s }
  }
  if (preset === 'this_week') {
    const first = new Date(now)
    const day = first.getDay() || 7
    first.setDate(first.getDate() - day + 1)
    return { from: formatDate(first), to: formatDate(now) }
  }
  if (preset === 'this_month') {
    return { from: formatDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: formatDate(now) }
  }
  return { from: '', to: '' }
}

const DEFAULT_PRESET = 'this_month'
const DEFAULT_RANGE = getPresetDates(DEFAULT_PRESET)

interface CommissionRow {
  reseller_id: number | null
  reseller_name: string
  recharges: number
  total_sales: number
  commission_percent: number
  admin_share: number
  reseller_share: number
}

interface RechargeItem {
  id: number
  reference: string
  reseller_id: number | null
  subscriber_name: string
  username: string
  plan_name: string
  price: number
  admin_share: number
  reseller_share: number
  created_at: string
}

interface CommissionData {
  rows: CommissionRow[]
  totals: { recharges: number; total_sales: number; admin_share: number; reseller_share: number }
  recharges: RechargeItem[]
}

const rowKey = (id: number | null) => (id === null ? 'direct' : String(id))

export default function PppoeCommissionSummary() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activePreset, setActivePreset] = useState<string>(DEFAULT_PRESET)
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE)
  const [resellerId, setResellerId] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [resellerOptions, setResellerOptions] = useState<SelectOption[]>([{ value: '', label: 'All Resellers' }])
  const [data, setData] = useState<CommissionData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users', { params: { role: 'reseller', per_page: 200 } })
      .then((res: any) => {
        const list = Array.isArray(res.data?.data?.data)
          ? res.data.data.data
          : Array.isArray(res.data?.data) ? res.data.data : []
        setResellerOptions([
          { value: '', label: 'All Resellers' },
          ...list.map((u: any) => ({ value: String(u.id), label: u.name, keywords: u.username })),
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

    api.get('/reports/pppoe-commission-summary', { params })
      .then((res: any) => {
        if (res.data?.success) setData(res.data.data)
      })
      .finally(() => setLoading(false))
  }, [dateRange, resellerId])

  const applyPreset = (key: string) => {
    setActivePreset(key)
    setDateRange(getPresetDates(key))
  }

  const isFiltered =
    activePreset !== DEFAULT_PRESET ||
    dateRange.from !== DEFAULT_RANGE.from ||
    dateRange.to !== DEFAULT_RANGE.to ||
    resellerId !== ''

  const clearFilters = () => {
    setActivePreset(DEFAULT_PRESET)
    setDateRange(getPresetDates(DEFAULT_PRESET))
    setResellerId('')
  }

  const rows = data?.rows || []
  const totals = data?.totals
  const recharges = data?.recharges || []
  const chartData = rows.map((r) => ({
    name: r.reseller_name,
    'Admin Share': r.admin_share,
    'Reseller Share': r.reseller_share,
  }))

  return (
    <div className="space-y-5">
      <PageTitle
        title="PPPoE Commission Summary"
        subtitle="Commission split between admin and each reseller on PPPoE recharges"
        icon={<Percent size={22} className="text-emerald-500" />}
      />

      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-100/80 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-full">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => applyPreset(item.key)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                  activePreset === item.key ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-700'
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <FilterX size={14} /> Clear Filter
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {isAdmin && (
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">Reseller</label>
              <Combobox value={resellerId} onChange={setResellerId} options={resellerOptions} placeholder="All Resellers" className="w-full" />
            </div>
          )}
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">From Date</label>
            <DualDatePicker
              label="From Date"
              value={dateRange.from}
              onChange={(val) => { setActivePreset('custom'); setDateRange((p) => ({ ...p, from: val })) }}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">To Date</label>
            <DualDatePicker
              label="To Date"
              value={dateRange.to}
              onChange={(val) => { setActivePreset('custom'); setDateRange((p) => ({ ...p, to: val })) }}
            />
          </div>
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Total Recharge Sales</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(totals?.total_sales || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Recharges: {num(totals?.recharges || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Wallet size={18} /></div>
            </div>
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Admin Share</p>
                <p className="text-xl font-extrabold text-indigo-600 mt-1">{rs(totals?.admin_share || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Commission + direct sales kept by admin</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Landmark size={18} /></div>
            </div>
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Reseller Share</p>
                <p className="text-xl font-extrabold text-purple-600 mt-1">{rs(totals?.reseller_share || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Kept by resellers</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0"><Percent size={18} /></div>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
              <h3 className="text-sm font-bold text-primary mb-4">Commission Split by Reseller</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => rs(Number(v))} />
                    <Legend />
                    <Bar dataKey="Admin Share" stackId="a" fill="#6366f1" />
                    <Bar dataKey="Reseller Share" stackId="a" fill="#a855f7" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-3 font-bold">Reseller</th>
                  <th className="px-4 py-3 font-bold text-right">Recharges</th>
                  <th className="px-4 py-3 font-bold text-right">Total Sales</th>
                  <th className="px-4 py-3 font-bold text-right">Commission %</th>
                  <th className="px-4 py-3 font-bold text-right">Admin Share</th>
                  <th className="px-4 py-3 font-bold text-right">Reseller Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No PPPoE recharges in this period.</td></tr>
                )}
                {rows.map((r) => {
                  const key = rowKey(r.reseller_id)
                  const open = expanded === key
                  const detail = recharges.filter((x) => rowKey(x.reseller_id) === key)
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => setExpanded(open ? null : key)}
                        className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer"
                      >
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          <span className="inline-flex items-center gap-1.5">
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {r.reseller_name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{num(r.recharges)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{rs(r.total_sales)}</td>
                        <td className="px-4 py-3 text-right">{r.commission_percent}%</td>
                        <td className="px-4 py-3 text-right text-indigo-600 font-semibold">{rs(r.admin_share)}</td>
                        <td className="px-4 py-3 text-right text-purple-600 font-semibold">{rs(r.reseller_share)}</td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/50">
                          <td colSpan={6} className="px-4 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-slate-400">
                                  <th className="py-1.5 font-semibold">Reference</th>
                                  <th className="py-1.5 font-semibold">Subscriber</th>
                                  <th className="py-1.5 font-semibold">Plan</th>
                                  <th className="py-1.5 font-semibold">Date</th>
                                  <th className="py-1.5 font-semibold text-right">Price</th>
                                  <th className="py-1.5 font-semibold text-right">Admin</th>
                                  <th className="py-1.5 font-semibold text-right">Reseller</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((x) => (
                                  <tr key={x.id} className="border-t border-slate-100">
                                    <td className="py-1.5 font-mono">{x.reference}</td>
                                    <td className="py-1.5">{x.subscriber_name}</td>
                                    <td className="py-1.5">{x.plan_name}</td>
                                    <td className="py-1.5">{x.created_at?.slice(0, 10)}</td>
                                    <td className="py-1.5 text-right">{rs(x.price)}</td>
                                    <td className="py-1.5 text-right">{rs(x.admin_share)}</td>
                                    <td className="py-1.5 text-right">{rs(x.reseller_share)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              {rows.length > 0 && totals && (
                <tfoot>
                  <tr className="bg-slate-50 font-extrabold text-slate-800">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{num(totals.recharges)}</td>
                    <td className="px-4 py-3 text-right">{rs(totals.total_sales)}</td>
                    <td className="px-4 py-3 text-right">
                      {totals.total_sales > 0 ? Math.round((totals.admin_share / totals.total_sales) * 10000) / 100 : 0}%
                    </td>
                    <td className="px-4 py-3 text-right text-indigo-600">{rs(totals.admin_share)}</td>
                    <td className="px-4 py-3 text-right text-purple-600">{rs(totals.reseller_share)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}
