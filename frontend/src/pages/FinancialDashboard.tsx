import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Scale, FileText, Calendar, Wallet, Database, RefreshCw, Layers
} from 'lucide-react'
import { api } from '../lib/api'
import { useQuery } from '../lib/cache'
import { rs, num, date } from '../lib/format'
import { PageTitle, GlassCard, Spinner } from '../components/ui'

type FilterPeriod = 'all_time' | 'this_month' | 'last_month' | 'this_year' | 'custom'

export default function FinancialDashboard() {
  const [period, setPeriod] = useState<FilterPeriod>('all_time')
  const [fromDate, setFromDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [toDate, setToDate] = useState<string>(new Date().toISOString().split('T')[0])

  const { data: d, loading, refetch } = useQuery<any>(
    `financial-dashboard-${period}-${fromDate}-${toDate}`,
    () => api.get('/accounts/financial-dashboard', {
      params: {
        period,
        from_date: period === 'custom' ? fromDate : undefined,
        to_date: period === 'custom' ? toDate : undefined,
      }
    }).then((r) => r.data.data)
  )


  const summary = d?.summary || { total_revenue: 0, total_expenses: 0, net_profit: 0, is_profitable: true }
  const incomeStmt = d?.income_statement || { gross_operating_revenue: 0, operating_expenses: 0, net_operating_profit: 0, gb_voucher_revenue: 0, pppoe_revenue: 0, other_revenue: 0 }
  const balanceSheet = d?.balance_sheet || {
    assets: { items: [], total: 0 },
    liabilities_and_equity: { liabilities: [], equity: [], total_liabilities: 0, total_equity: 0, total_liabilities_and_equity: 0 }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageTitle
        title="Financial Dashboard"
        subtitle="Real-time financial statement, income activity, and balance sheet"
        icon={<Scale size={22} className="text-blue-600" />}
      />

      {/* Top Filter Bar */}
      <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mr-2">Filter Period:</span>
          {(
            [
              { key: 'all_time', label: 'All Time' },
              { key: 'this_month', label: 'This Month' },
              { key: 'last_month', label: 'Last Month' },
              { key: 'this_year', label: 'This Year' },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setPeriod(item.key)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
                period === item.key
                  ? 'bg-[#003164] text-white shadow-blue-900/20'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs font-medium text-slate-600 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">Start</span>
            <div className="relative flex items-center">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPeriod('custom')
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">End</span>
            <div className="relative flex items-center">
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value)
                  setPeriod('custom')
                }}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-all"
            title="Refresh Financial Data"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Top 3 Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Total Revenue Generated */}
            <GlassCard className="p-6 relative overflow-hidden flex justify-between items-start bg-white">
              <div>
                <p className="text-xs font-semibold text-emerald-600 tracking-wide">Total Revenue Generated</p>
                <h2 className="text-2xl lg:text-3xl font-bold text-emerald-600 mt-2">{rs(summary.total_revenue)}</h2>
                <p className="text-[11px] text-slate-400 font-medium mt-1">All operating revenue</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-500 shadow-sm">
                <TrendingUp size={22} />
              </div>
            </GlassCard>

            {/* Total Operating Expenses */}
            <GlassCard className="p-6 relative overflow-hidden flex justify-between items-start bg-white">
              <div>
                <p className="text-xs font-semibold text-rose-600 tracking-wide">Total Operating Expenses</p>
                <h2 className="text-2xl lg:text-3xl font-bold text-rose-600 mt-2">{rs(summary.total_expenses)}</h2>
                <p className="text-[11px] text-slate-400 font-medium mt-1">All operating & payroll expenses</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 shadow-sm">
                <TrendingDown size={22} />
              </div>
            </GlassCard>

            {/* Net Operating Profit */}
            <GlassCard className="p-6 relative overflow-hidden flex justify-between items-start bg-white">
              <div>
                <p className="text-xs font-semibold text-blue-600 tracking-wide">Net Operating Profit</p>
                <h2 className="text-2xl lg:text-3xl font-bold text-blue-600 mt-2">{rs(summary.net_profit)}</h2>
                <p className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  {summary.is_profitable ? 'Profitable Operations' : 'Operating Loss'}
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 shadow-sm">
                <Scale size={22} />
              </div>
            </GlassCard>
          </div>

          {/* Main Financial Report Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Income Statement (Profit & Loss) */}
            <GlassCard className="p-6 bg-white space-y-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 text-slate-600 rounded-xl">
                      <FileText size={18} />
                    </div>
                    <h3 className="font-bold text-slate-800 text-base">Income Statement (Profit & Loss)</h3>
                  </div>
                  <span className="text-xs font-semibold text-slate-400">Operating Activity</span>
                </div>

                <div className="mt-6 space-y-5">
                  {/* Revenue section */}
                  {incomeStmt.gross_operating_revenue === 0 ? (
                    <p className="text-xs text-slate-400 italic">No revenue posted in this period.</p>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex justify-between text-xs text-slate-600 font-medium">
                        <span>Wallet Voucher Commission Revenue</span>
                        <span className="font-semibold text-slate-900">{rs(incomeStmt.commission_revenue || 0)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 font-medium">
                        <span>GB Allocation Revenue</span>
                        <span className="font-semibold text-slate-900">{rs(incomeStmt.gb_allocation_revenue || 0)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 font-medium">
                        <span>GB Voucher Sales Revenue</span>
                        <span className="font-semibold text-slate-900">{rs(incomeStmt.gb_voucher_revenue || 0)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 font-medium">
                        <span>PPPoE Sales Revenue</span>
                        <span className="font-semibold text-slate-900">{rs(incomeStmt.pppoe_revenue || 0)}</span>
                      </div>
                      {(incomeStmt.other_revenue || 0) > 0 && (
                        <div className="flex justify-between text-xs text-slate-600 font-medium">
                          <span>Other Service Invoices Revenue</span>
                          <span className="font-semibold text-slate-900">{rs(incomeStmt.other_revenue)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="font-bold text-sm text-slate-800">Total Gross Operating Revenue</span>
                    <span className="font-bold text-sm text-emerald-600">{rs(incomeStmt.gross_operating_revenue)}</span>
                  </div>

                  {/* Expenses section */}
                  {incomeStmt.operating_expenses === 0 ? (
                    <p className="text-xs text-slate-400 italic pt-3">No expenses posted in this period.</p>
                  ) : (
                    <div className="pt-2 text-xs text-slate-600 flex justify-between font-medium">
                      <span>Operating & Administrative Expenses</span>
                      <span className="font-semibold text-rose-600">{rs(incomeStmt.operating_expenses)}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="font-bold text-sm text-slate-800">Total Operating Expenses</span>
                    <span className="font-bold text-sm text-rose-600">{rs(incomeStmt.operating_expenses)}</span>
                  </div>
                </div>
              </div>

              {/* Net Profit Pill */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between mt-6">
                <span className="font-bold text-sm text-emerald-800">Net Operating Profit (Loss)</span>
                <span className="font-bold text-base text-emerald-700">{rs(incomeStmt.net_operating_profit)}</span>
              </div>
            </GlassCard>

            {/* Right Column: Balance Sheet */}
            <div className="space-y-6 flex flex-col justify-between">
              {/* Assets Card */}
              <GlassCard className="p-6 bg-white space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <div className="p-2 bg-slate-100 text-slate-600 rounded-xl">
                    <Layers size={18} />
                  </div>
                  <h3 className="font-bold text-slate-800 text-base">Balance Sheet — Assets</h3>
                </div>

                <div className="py-2 space-y-3">
                  {balanceSheet.assets.items.length === 0 || balanceSheet.assets.total === 0 ? (
                    <p className="text-xs text-slate-400 italic py-2">No activity posted yet.</p>
                  ) : (
                    balanceSheet.assets.items.map((asset: any) => (
                      <div key={asset.code} className="flex justify-between items-center text-xs text-slate-700 font-medium">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-slate-400 font-semibold">{asset.code}</span>
                          <span>{asset.name}</span>
                        </span>
                        <span className="font-semibold text-slate-900">{rs(asset.balance)}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex items-center justify-between">
                  <span className="font-bold text-sm text-emerald-800">Total Assets</span>
                  <span className="font-bold text-base text-emerald-700">{rs(balanceSheet.assets.total)}</span>
                </div>
              </GlassCard>

              {/* Liabilities & Equity Card */}
              <GlassCard className="p-6 bg-white space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                  <div className="p-2 bg-slate-100 text-slate-600 rounded-xl">
                    <Scale size={18} />
                  </div>
                  <h3 className="font-bold text-slate-800 text-base">Balance Sheet — Liabilities & Equity</h3>
                </div>


                <div className="space-y-4 py-1">
                  {/* Liabilities */}
                  {balanceSheet.liabilities_and_equity.liabilities?.some((l: any) => l.balance > 0) && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 tracking-tight mb-2">Liabilities</h4>
                      <div className="space-y-2 text-xs">
                        {balanceSheet.liabilities_and_equity.liabilities
                          .filter((l: any) => l.balance > 0)
                          .map((l: any) => (
                            <div key={l.code} className="flex justify-between text-slate-700 font-medium">
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-slate-400 font-bold">{l.code}</span>
                                <span>{l.name}</span>
                              </span>
                              <span className="font-bold text-rose-600">{rs(l.balance)}</span>
                            </div>
                          ))}
                      </div>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100 font-semibold text-slate-700 mt-2">
                        <span>Total Liabilities</span>
                        <span className="font-bold text-rose-600">{rs(balanceSheet.liabilities_and_equity.total_liabilities)}</span>
                      </div>
                    </div>
                  )}

                  {/* Equity */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 tracking-tight mb-2">Owner's Equity</h4>
                    <div className="space-y-2 text-xs">

                      {balanceSheet.liabilities_and_equity.equity.map((eq: any) => (
                        <div key={eq.code} className="flex justify-between text-slate-700 font-medium">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-slate-400 font-bold">{eq.code}</span>
                            <span>{eq.name}</span>
                          </span>
                          <span className="font-bold text-slate-900">{rs(eq.balance)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100 font-semibold text-slate-700">
                    <span>Subtotal</span>
                    <span className="font-bold">{rs(balanceSheet.liabilities_and_equity.total_equity)}</span>
                  </div>
                </div>

                <div className="bg-slate-100/90 border border-slate-200/80 rounded-2xl p-4 flex items-center justify-between">
                  <span className="font-extrabold text-sm text-slate-800">Total Liabilities & Equity</span>
                  <span className="font-extrabold text-base text-slate-900">{rs(balanceSheet.liabilities_and_equity.total_liabilities_and_equity)}</span>
                </div>
              </GlassCard>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
