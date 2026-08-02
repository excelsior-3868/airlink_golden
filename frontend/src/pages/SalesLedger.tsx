import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen, Calendar, Filter, RefreshCw, Users, Search, DollarSign,
  TrendingUp, Wallet, Database, ArrowUpRight, ArrowDownLeft, FileText, CheckCircle2, AlertCircle
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, datet, date } from '../lib/format'
import { GlassCard, PageTitle, Pill, Pagination, EmptyState, Spinner, Combobox, SelectOption } from '../components/ui'
import { DualDatePicker } from '../components/DualDatePicker'

export default function SalesLedger() {
  const { user } = useAuth()
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [targetUserId, setTargetUserId] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [page, setPage] = useState<number>(1)

  // Fetch Sales Ledger Data
  const queryParams = new URLSearchParams()
  if (roleFilter) queryParams.set('role', roleFilter)
  if (targetUserId) queryParams.set('user_id', targetUserId)
  if (fromDate) queryParams.set('from_date', fromDate)
  if (toDate) queryParams.set('to_date', toDate)
  if (search) queryParams.set('search', search)
  queryParams.set('page', String(page))

  const { data: ledgerData, loading, refetch } = useQuery<any>(
    `accounts/sales-ledger?${queryParams.toString()}`,
    () => api.get(`/accounts/sales-ledger?${queryParams.toString()}`).then((r) => r.data.data),
  )

  // Fetch Users list for dropdown selector
  const { data: usersList } = useQuery<any[]>(
    'users?per_page=500',
    () => api.get('/users', { params: { per_page: 500 } }).then((r) => r.data.data?.data || r.data.data || []),
  )

  useEffect(() => {
    setPage(1)
  }, [roleFilter, targetUserId, fromDate, toDate, search])

  const summary = ledgerData?.summary || { total_invoiced: 0, total_paid: 0, total_due: 0, total_gb: 0 }
  const userSummaries = ledgerData?.user_summaries || []
  const ledger = ledgerData?.ledger || { data: [], current_page: 1, last_page: 1, total: 0 }

  const resetFilters = () => {
    setRoleFilter('')
    setTargetUserId('')
    setFromDate('')
    setToDate('')
    setSearch('')
    setPage(1)
  }

  const roleOptions: SelectOption[] = [
    { value: '', label: 'All Roles (Resellers & Sellers)' },
    ...(user?.role === 'admin' ? [{ value: 'reseller', label: 'Resellers Only' }] : []),
    { value: 'seller', label: 'Sellers Only' },
  ]

  const userOptions: SelectOption[] = [
    { value: '', label: 'All Accounts' },
    ...(usersList || [])
      .filter((u: any) => !roleFilter || u.role === roleFilter)
      .map((u: any) => ({
        value: String(u.id),
        label: `${u.name} (${u.username})`,
        badge: <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{u.role}</span>,
      })),
  ]

  return (
    <div className="space-y-6">
      <PageTitle
        title="Sales Ledger"
        subtitle="Track sales invoices, payment collections, and dues by reseller & seller"
        icon={<BookOpen size={22} className="text-blue-600" />}
      />

      {/* Filter Toolbar */}
      <GlassCard className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
            <Filter size={16} className="text-blue-500" />
            <span>Filter Sales Ledger</span>
          </div>
          <button
            onClick={resetFilters}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all"
          >
            <RefreshCw size={13} />
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* From Date */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">From Date</label>
            <DualDatePicker
              label="From Date"
              value={fromDate}
              onChange={(val) => setFromDate(val)}
            />
          </div>

          {/* To Date */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">To Date</label>
            <DualDatePicker
              label="To Date"
              value={toDate}
              onChange={(val) => setToDate(val)}
            />
          </div>

          {/* Search */}
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search account / reference..."
                className="input pl-9 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Commission Earned</p>
            <p className="text-xl font-extrabold text-indigo-600 mt-1">
              {rs(user?.role === 'admin' ? summary.total_admin_commission : (summary.total_reseller_commission ?? summary.total_admin_commission ?? 0))}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{gb(summary.total_gb)} Allocated</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
            <DollarSign size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Payments Collected</p>
            <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary.total_paid)}</p>
            <p className="text-[11px] text-emerald-600 font-bold mt-1">Received in Cash/Bank</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Net Outstanding Dues</p>
            <p className="text-xl font-extrabold text-rose-600 mt-1">{rs(summary.total_due)}</p>
            <p className="text-[11px] text-rose-500 font-bold mt-1">Pending Collection</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
            <AlertCircle size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Active Accounts</p>
            <p className="text-xl font-extrabold text-purple-600 mt-1">{userSummaries.length}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">
              {summary.reseller_count || 0} Resellers · {summary.seller_count || 0} Sellers
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center shrink-0">
            <Users size={22} />
          </div>
        </GlassCard>
      </div>

      {/* Account-by-Account Sales Breakdown */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Per-Account Sales Summary</h3>
            <p className="text-xs text-slate-400">Aggregated breakdown for each reseller and seller</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>GB Rate</th>
                <th>Total GB Sales</th>
                <th>Commission Share (Rs)</th>
                <th>Collected (Rs)</th>
                <th>Outstanding Due (Rs)</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {userSummaries.map((u: any, idx: number) => (
                <tr key={u.id} className="hover:bg-slate-50/50">
                  <td className="font-semibold text-slate-800">
                    <div>{u.name}</div>
                    <div className="text-xs font-mono text-slate-400">{u.username}</div>
                  </td>
                  <td>
                    <Pill tone={u.role === 'reseller' ? 'secondary' : 'warning'}>
                      {u.role.toUpperCase()}
                    </Pill>
                  </td>
                  <td className="font-mono text-xs">{rs(u.gb_rate)}/GB</td>
                  <td className="font-bold text-slate-700">{gb(u.total_gb_sales)}</td>
                  <td className="font-bold text-indigo-600">{rs(u.role === 'admin' ? u.total_admin_share : u.total_reseller_share)}</td>
                  <td className="font-bold text-emerald-600">{rs(u.total_paid)}</td>
                  <td className="font-bold text-rose-600">{rs(u.wallet_due)}</td>
                  <td>
                    <button
                      onClick={() => setTargetUserId(String(u.id))}
                      className="px-2.5 py-1 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-bold transition-all"
                    >
                      Filter Ledger
                    </button>
                  </td>
                </tr>
              ))}
              {userSummaries.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400">
                    No account summaries found for current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* Detailed Itemized Sales & Payment Ledger */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Detailed Transaction Ledger</h3>
            <p className="text-xs text-slate-400">Itemized statement of GB allocations and cash collections</p>
          </div>
          {loading && <Spinner />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Reference</th>
                <th>Account</th>
                <th>Invoiced / Payment (Rs)</th>
                <th>Due / Balance (Rs)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(ledger.data || []).map((item: any) => (
                <tr key={item.id} className="hover:bg-slate-50/50">
                  <td className="text-xs font-mono text-slate-500">{datet(item.created_at)}</td>
                  <td>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                        item.type === 'invoice'
                          ? 'bg-blue-50 text-blue-700 border border-blue-100'
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      }`}
                    >
                      {item.type === 'invoice' ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
                      {item.type === 'invoice' ? 'Invoiced Sale' : 'Payment Received'}
                    </span>
                  </td>
                  <td className="font-mono text-xs font-semibold text-slate-700">{item.reference}</td>
                  <td className="font-semibold text-slate-800">{item.party_name}</td>
                  <td className={`font-extrabold ${item.type === 'invoice' ? 'text-blue-600' : 'text-emerald-600'}`}>
                    {rs(item.amount)}
                  </td>
                  <td className="font-bold text-slate-600">
                    {item.due_amount > 0 ? (
                      <span className="text-rose-600">{rs(item.due_amount)} Due</span>
                    ) : (
                      <span className="text-emerald-600">Settled</span>
                    )}
                  </td>
                  <td>
                    <Pill tone={item.status === 'PAID' ? 'success' : 'danger'}>{item.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(ledger.data || []).length === 0 && <EmptyState>No sales or payment records found.</EmptyState>}
        </div>

        <div className="p-4 border-t border-slate-100">
          <Pagination meta={ledger} onPage={setPage} />
        </div>
      </GlassCard>
    </div>
  )
}
