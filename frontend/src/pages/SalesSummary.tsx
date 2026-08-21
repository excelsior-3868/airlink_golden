import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, Ticket, Wallet, Database, Users2, RefreshCw, Calendar, Search } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rs, gb, num } from '../lib/format'
import { Spinner, CustomSelect, SelectOption } from '../components/ui'

export default function SalesSummary() {
  const { user } = useAuth()

  // Preset Date Ranges
  const getPresetDates = (preset: string) => {
    const now = new Date()
    const formatDate = (d: Date) => d.toISOString().split('T')[0]

    if (preset === 'today') {
      const todayStr = formatDate(now)
      return { from: todayStr, to: todayStr }
    } else if (preset === 'yesterday') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      const yStr = formatDate(y)
      return { from: yStr, to: yStr }
    } else if (preset === 'this_week') {
      const first = new Date(now)
      const day = first.getDay() || 7
      first.setDate(first.getDate() - day + 1)
      return { from: formatDate(first), to: formatDate(now) }
    } else if (preset === 'this_month') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: formatDate(first), to: formatDate(now) }
    }
    return { from: '', to: '' }
  }

  const [activePreset, setActivePreset] = useState<string>('today')
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(getPresetDates('today'))

  // Filter dropdown state
  const [resellerId, setResellerId] = useState<string>('')
  const [sellerId, setSellerId] = useState<string>('')

  // Search & tab state
  const [planSearch, setPlanSearch] = useState<string>('')
  const [pppoeTab, setPppoeTab] = useState<'new' | 'recharge'>('new')

  // Reseller and Seller option lists
  const [resellerOptions, setResellerOptions] = useState<SelectOption[]>([
    { value: '', label: 'All Resellers' }
  ])
  const [sellerOptions, setSellerOptions] = useState<SelectOption[]>([
    { value: '', label: 'All Sellers' }
  ])

  // Data state
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState<boolean>(true)

  // Fetch Resellers (for Admin)
  useEffect(() => {
    if (user?.role === 'admin') {
      api.get('/users', { params: { role: 'reseller', per_page: 200 } })
        .then((res: any) => {
          const list = Array.isArray(res.data?.data?.data)
            ? res.data.data.data
            : Array.isArray(res.data?.data)
            ? res.data.data
            : []
          setResellerOptions([
            { value: '', label: 'All Resellers' },
            ...list.map((u: any) => ({ value: String(u.id), label: `${u.name} (${u.username})` }))
          ])
        })
        .catch(() => {})
    }
  }, [user])

  // Fetch Sellers (for Admin or Reseller)
  useEffect(() => {
    if (user?.role === 'admin' || user?.role === 'reseller') {
      const params: any = { role: 'seller', per_page: 200 }
      if (user?.role === 'admin' && resellerId) {
        params.parent_id = resellerId
      }
      api.get('/users', { params })
        .then((res: any) => {
          const list = Array.isArray(res.data?.data?.data)
            ? res.data.data.data
            : Array.isArray(res.data?.data)
            ? res.data.data
            : []
          setSellerOptions([
            { value: '', label: 'All Sellers' },
            ...list.map((u: any) => ({ value: String(u.id), label: `${u.name} (${u.username})` }))
          ])
        })
        .catch(() => {})
    }
  }, [user, resellerId])

  // Fetch Sales Summary Report
  const fetchSummary = () => {
    setLoading(true)
    const params: any = {}
    if (dateRange.from) params.from = dateRange.from
    if (dateRange.to) params.to = dateRange.to
    if (resellerId) params.reseller_id = resellerId
    if (sellerId) params.seller_id = sellerId

    api.get('/reports/sales-summary', { params })
      .then((res: any) => {
        if (res.data?.success) {
          setData(res.data.data)
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchSummary()
  }, [dateRange, resellerId, sellerId])

  const applyPreset = (presetKey: string) => {
    setActivePreset(presetKey)
    const range = getPresetDates(presetKey)
    setDateRange(range)
  }

  const summary = data?.summary
  const voucherPlans = data?.voucher_plans || []
  const pppoeNewPlans = data?.pppoe_new_plans || []
  const pppoeRechargePlans = data?.pppoe_recharge_plans || []

  const filteredVoucherPlans = voucherPlans.filter((vp: any) =>
    vp.plan_name.toLowerCase().includes(planSearch.toLowerCase())
  )

  return (
    <div className="space-y-5">
      {/* Top Filter Bar */}
      <div className="bg-white rounded-3xl p-3.5 shadow-sm border border-slate-100/80 flex flex-wrap items-center justify-between gap-4">
        {/* Preset Buttons */}
        <div className="flex items-center gap-1 bg-slate-100/70 p-1 rounded-full">
          {[
            { key: 'today', label: 'Today' },
            { key: 'yesterday', label: 'Yesterday' },
            { key: 'this_week', label: 'This Week' },
            { key: 'this_month', label: 'This Month' },
          ].map((item) => {
            const isActive = activePreset === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => applyPreset(item.key)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                  isActive
                    ? 'bg-white text-slate-800 shadow-xs'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Date Pickers & Dropdowns */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-semibold">
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 text-slate-500">
              <Calendar size={14} /> From:
            </span>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => {
                setActivePreset('custom')
                setDateRange((prev) => ({ ...prev, from: e.target.value }))
              }}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">To:</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => {
                setActivePreset('custom')
                setDateRange((prev) => ({ ...prev, to: e.target.value }))
              }}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
            />
          </div>

          {user?.role === 'admin' && (
            <CustomSelect
              value={resellerId}
              onChange={(val) => {
                setResellerId(val)
                setSellerId('')
              }}
              options={resellerOptions}
              placeholder="All Resellers"
              searchable={true}
            />
          )}

          {(user?.role === 'admin' || user?.role === 'reseller') && (
            <CustomSelect
              value={sellerId}
              onChange={(val) => setSellerId(val)}
              options={sellerOptions}
              placeholder="All Sellers"
              searchable={true}
            />
          )}
        </div>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : (
        <>
          {/* Top 5 Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Card 1: Total Sales Revenue */}
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Total Sales Revenue</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary?.total_sales_revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Vouchers + PPPoE Combined</p>
              </div>
              <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <TrendingUp size={18} />
              </div>
            </div>

            {/* Card 2: Wallet Voucher Sales */}
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Wallet Voucher Sales</p>
                <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary?.wallet_voucher_sales?.revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Vouchers Sold: {num(summary?.wallet_voucher_sales?.count || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <Wallet size={18} />
              </div>
            </div>

            {/* Card 3: GB Voucher Sales */}
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">GB Voucher Sales</p>
                <p className="text-xl font-extrabold text-sky-500 mt-1">{rs(summary?.gb_voucher_sales?.revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  Sold: {num(summary?.gb_voucher_sales?.count || 0)} ({gb(summary?.gb_voucher_sales?.total_gb || 0)})
                </p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-cyan-50 text-cyan-500 flex items-center justify-center shrink-0">
                <Database size={18} />
              </div>
            </div>

            {/* Card 4: New PPPoE Subscribers */}
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">New PPPoE Subscribers</p>
                <p className="text-xl font-extrabold text-purple-600 mt-1">{rs(summary?.pppoe_new_subscribers?.revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">New Registrations: {num(summary?.pppoe_new_subscribers?.count || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <Users2 size={18} />
              </div>
            </div>

            {/* Card 5: Active PPPoE Recharges */}
            <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-sm flex items-start justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Active PPPoE Recharges</p>
                <p className="text-xl font-extrabold text-purple-600 mt-1">{rs(summary?.pppoe_active_recharges?.revenue || 0)}</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">Recharges: {num(summary?.pppoe_active_recharges?.count || 0)}</p>
              </div>
              <div className="w-9 h-9 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <RefreshCw size={18} />
              </div>
            </div>
          </div>

          {/* Voucher Card Sales Summary Section */}
          <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <div className="text-rose-500 shrink-0">
                  <Ticket size={20} />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800 text-base leading-snug">Voucher Card Sales Summary</h3>
                  <p className="text-xs text-slate-400">Voucher card sales grouped by plan and package type for selected date range</p>
                </div>
              </div>

              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search Plan Name..."
                  value={planSearch}
                  onChange={(e) => setPlanSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-full pl-8 pr-4 py-1.5 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-[#002d5d] text-white font-extrabold">
                    <th className="py-3 px-4 rounded-tl-xl">Plan Name</th>
                    <th className="py-3 px-4">Package Type</th>
                    <th className="py-3 px-4 text-center">Vouchers Sold</th>
                    <th className="py-3 px-4 text-center">Data Volume</th>
                    <th className="py-3 px-4 text-right rounded-tr-xl">Sales Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredVoucherPlans.map((vp: any) => (
                    <tr key={vp.plan_id} className="hover:bg-slate-50/50">
                      <td className="py-3.5 px-4 font-extrabold text-slate-800">{vp.plan_name}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold ${
                          vp.package_type === 'wallet'
                            ? 'bg-purple-50 text-purple-600 border border-purple-100'
                            : 'bg-cyan-50 text-cyan-600 border border-cyan-100'
                        }`}>
                          {vp.package_type === 'wallet' ? 'Wallet' : 'GB Stock'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center font-extrabold text-slate-800">{num(vp.count)}</td>
                      <td className="py-3.5 px-4 text-center font-medium text-slate-600">{gb(vp.data_gb)}</td>
                      <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(vp.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredVoucherPlans.length === 0 && (
                <div className="py-8 text-center text-xs text-slate-400 font-semibold">No voucher sales recorded for this date range.</div>
              )}
            </div>
          </div>

          {/* PPPoE Subscriber Summary Section */}
          {user?.role !== 'seller' && (
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="text-indigo-500 shrink-0">
                    <Users2 size={20} />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-base leading-snug">PPPoE Subscriber Summary</h3>
                    <p className="text-xs text-slate-400">New subscriber registrations and active renewals during the selected date range</p>
                  </div>
                </div>

                <div className="flex items-center bg-slate-100/70 p-1 rounded-full">
                  <button
                    type="button"
                    onClick={() => setPppoeTab('new')}
                    className={`px-4 py-1.5 text-xs font-extrabold rounded-full transition-all ${
                      pppoeTab === 'new'
                        ? 'bg-white text-[#002d5d] border border-[#002d5d]/30 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    New Subscribers ({num(summary?.pppoe_new_subscribers?.count || 0)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPppoeTab('recharge')}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${
                      pppoeTab === 'recharge'
                        ? 'bg-white text-[#002d5d] border border-[#002d5d]/30 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    Subscribers / Recharges ({num(summary?.pppoe_active_recharges?.count || 0)})
                  </button>
                </div>
              </div>

              {pppoeTab === 'new' ? (
                pppoeNewPlans.length > 0 ? (
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
                        {pppoeNewPlans.map((np: any) => (
                          <tr key={np.plan_id} className="hover:bg-slate-50/50">
                            <td className="py-3.5 px-4 font-extrabold text-slate-800">{np.plan_name}</td>
                            <td className="py-3.5 px-4 text-center font-extrabold text-slate-800">{num(np.count)}</td>
                            <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(np.revenue)}</td>
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
              ) : (
                pppoeRechargePlans.length > 0 ? (
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
                        {pppoeRechargePlans.map((rp: any) => (
                          <tr key={rp.plan_id} className="hover:bg-slate-50/50">
                            <td className="py-3.5 px-4 font-extrabold text-slate-800">{rp.plan_name}</td>
                            <td className="py-3.5 px-4 text-center font-extrabold text-slate-800">{num(rp.count)}</td>
                            <td className="py-3.5 px-4 text-right font-extrabold text-emerald-600">{rs(rp.revenue)}</td>
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
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
