import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import {
  BookOpen, Receipt, ArrowLeftRight, TrendingUp, Wallet, DollarSign,
  Plus, Filter, RefreshCw, Search, Users, FileText, CheckCircle2, AlertCircle,
  Database, HandCoins, ArrowUpRight, ArrowDownLeft, Trash2, Edit3, Tag, Calendar, UserCheck, Activity,
  HandCoins as CollectIcon, PiggyBank, BarChart3, List as ListIcon,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, datet, date } from '../lib/format'
import { GlassCard, PageTitle, Pill, Pagination, EmptyState, Spinner, Modal, Combobox, SelectOption, ConfirmModal, CustomSelect, renderPaymentMethodIcon } from '../components/ui'
import { DualDatePicker } from '../components/DualDatePicker'
import RadiusLogs from './RadiusLogs'

// Sub-Tab Types
type LedgerTab = 'sales' | 'expenses' | 'commission' | 'transactions'

const EXPENSE_CATEGORIES = [
  { value: 'salary', label: 'Salary & Compensation' },
  { value: 'bandwidth', label: 'Bandwidth (BW)' },
  { value: 'equipment', label: 'Equipment & Hardware' },
  { value: 'rent', label: 'Office & Tower Rent' },
  { value: 'maintenance', label: 'Maintenance & Repairs' },
  { value: 'utility', label: 'Utilities (Electricity/Water)' },
  { value: 'marketing', label: 'Marketing & Sales' },
  { value: 'other', label: 'Other Expenses' },
]

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'esewa', label: 'eSewa' },
  { value: 'khalti', label: 'Khalti' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' },
]

export default function Ledger() {
  const [confirmDeleteExpenseId, setConfirmDeleteExpenseId] = useState<number | null>(null)
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  // Active Tab from URL query or default to 'sales'
  const currentTabParam = (searchParams.get('tab') as LedgerTab) || 'sales'
  const [activeTab, setActiveTab] = useState<LedgerTab>(
    ['sales', 'expenses', 'commission', 'transactions'].includes(currentTabParam) ? currentTabParam : 'sales'
  )

  useEffect(() => {
    const tabParam = (searchParams.get('tab') as LedgerTab) || 'sales'
    if (['sales', 'expenses', 'commission', 'transactions'].includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [searchParams])

  const handleTabChange = (tab: LedgerTab) => {
    setActiveTab(tab)
    setSearchParams({ tab })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageTitle
        title="Master Accounting & Ledger"
        subtitle="Unified financial dashboard for Sales, Operating Expenses, and Transaction Audits"
        icon={<BookOpen size={22} className="text-blue-600" />}
        action={
          (user?.role === 'admin' || user?.role === 'reseller') ? (
            <button
              onClick={() => window.dispatchEvent(new Event('open-add-expense'))}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 rounded-xl font-bold shadow-md shadow-blue-600/20"
            >
              <Plus size={15} /> Add Expense
            </button>
          ) : null
        }
      />

      <div className="inline-flex items-center gap-1.5 p-1.5 bg-slate-100/90 border border-slate-200/70 rounded-2xl shadow-inner select-none overflow-x-auto max-w-full mb-2">
        <button
          type="button"
          onClick={() => handleTabChange('sales')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 ${
            activeTab === 'sales'
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
          }`}
        >
          <BookOpen size={16} className={activeTab === 'sales' ? 'text-blue-600' : 'text-slate-400'} />
          <span>Sales & Revenue Ledger</span>
        </button>

        {(user?.role === 'admin' || user?.role === 'reseller') && (
          <button
            type="button"
            onClick={() => handleTabChange('expenses')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 ${
              activeTab === 'expenses'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
            }`}
          >
            <Receipt size={16} className={activeTab === 'expenses' ? 'text-rose-600' : 'text-slate-400'} />
            <span>Operating Expenses</span>
          </button>
        )}

        {(user?.role === 'admin' || user?.role === 'reseller') && (
          <button
            type="button"
            onClick={() => handleTabChange('commission')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 ${
              activeTab === 'commission'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
            }`}
          >
            <PiggyBank size={16} className={activeTab === 'commission' ? 'text-violet-600' : 'text-slate-400'} />
            <span>Commission Report</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleTabChange('transactions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shrink-0 ${
            activeTab === 'transactions'
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
          }`}
        >
          <ArrowLeftRight size={16} className={activeTab === 'transactions' ? 'text-indigo-600' : 'text-slate-400'} />
          <span>All Transactions Audit Log</span>
        </button>
      </div>

      {/* Tab Content View */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'sales' && <SalesLedgerView />}
          {activeTab === 'expenses' && (user?.role === 'admin' || user?.role === 'reseller') && <ExpensesLedgerView />}
          {activeTab === 'commission' && (user?.role === 'admin' || user?.role === 'reseller') && <CommissionReportView />}
          {activeTab === 'transactions' && <TransactionsAuditView />}
        </motion.div>
      </AnimatePresence>

      <GlobalAddExpenseModal />
    </div>
  )
}

/* ==========================================================================
   1. Sales & Revenue Ledger View
   ========================================================================== */
function SalesLedgerView() {
  const { user } = useAuth()
  const isReseller = user?.role === 'reseller'
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [targetUserId, setTargetUserId] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [page, setPage] = useState<number>(1)

  const toggleTypeFilter = (t: string) => setTypeFilter((cur) => (cur === t ? '' : t))

  const queryParams = new URLSearchParams()
  if (roleFilter) queryParams.set('role', roleFilter)
  if (targetUserId) queryParams.set('user_id', targetUserId)
  if (fromDate) queryParams.set('from_date', fromDate)
  if (toDate) queryParams.set('to_date', toDate)
  if (search) queryParams.set('search', search)
  if (typeFilter) queryParams.set('type', typeFilter)
  queryParams.set('page', String(page))

  const { data: ledgerData, loading, refetch } = useQuery<any>(
    `accounts/sales-ledger?${queryParams.toString()}`,
    () => api.get(`/accounts/sales-ledger?${queryParams.toString()}`).then((r) => r.data.data),
  )

  const { data: usersList } = useQuery<any[]>(
    'users?per_page=500',
    () => api.get('/users', { params: { per_page: 500 } }).then((r) => r.data.data?.data || r.data.data || []),
  )

  useEffect(() => {
    setPage(1)
  }, [roleFilter, targetUserId, fromDate, toDate, search, typeFilter])

  const summary = ledgerData?.summary || { total_invoiced: 0, total_paid: 0, total_due: 0, total_gb: 0, total_admin_commission: 0, total_reseller_commission: 0, total_commission_paid: 0, total_gb_voucher_sales: 0 }
  const userSummaries = ledgerData?.user_summaries || []
  const ledger = ledgerData?.ledger || { data: [], current_page: 1, last_page: 1, total: 0 }

  const resetFilters = () => {
    setRoleFilter('')
    setTargetUserId('')
    setFromDate('')
    setToDate('')
    setSearch('')
    setTypeFilter('')
    setPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Summary KPI Cards */}
      {user?.role === 'seller' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassCard
            onClick={() => toggleTypeFilter('voucher_sale')}
            className={`p-4 flex items-center justify-between cursor-pointer transition-shadow ${typeFilter === 'voucher_sale' ? 'ring-2 ring-indigo-400' : ''}`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-400">Total Voucher Sales</p>
              <p className="text-xl font-extrabold text-indigo-600 mt-1">
                {rs(summary.total_voucher_sales ?? summary.total_invoiced ?? 0)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">Voucher Revenue Generated</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <Tag size={22} />
            </div>
          </GlassCard>

          <GlassCard
            onClick={() => toggleTypeFilter('due')}
            className={`p-4 flex items-center justify-between cursor-pointer transition-shadow ${typeFilter === 'due' ? 'ring-2 ring-rose-400' : ''}`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-400">Due Payable to Reseller</p>
              <p className={`text-xl font-extrabold mt-1 ${((user as any)?.wallet_due ?? 0) > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                {rs((user as any)?.wallet_due ?? 0)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">Outstanding GB Quota Due</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              <Wallet size={22} />
            </div>
          </GlassCard>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. GB Voucher Sales (Reseller) / Commission Earned (Admin) */}
          <GlassCard
            onClick={() => toggleTypeFilter(isReseller ? 'gb_voucher_sale' : 'voucher_sale')}
            className={`p-4 flex items-center justify-between cursor-pointer transition-shadow ${typeFilter === (isReseller ? 'gb_voucher_sale' : 'voucher_sale') ? 'ring-2 ring-rose-400' : ''}`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-400">{isReseller ? 'GB Voucher Sales' : 'Commission Earned'}</p>
              <p className="text-xl font-extrabold text-rose-600 mt-1">
                {rs(isReseller ? (summary.total_gb_voucher_sales ?? 0) : (summary.total_commission_paid ?? 0))}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">{isReseller ? 'GB Package Voucher Revenue' : `${gb(summary.total_gb)} Allocated`}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
              <Tag size={22} />
            </div>
          </GlassCard>

          {/* 2. Wallet Voucher Sales (Reseller) / Commission Dues (Admin) */}
          <GlassCard
            onClick={() => toggleTypeFilter(isReseller ? 'wallet_voucher_sale' : 'commission_due')}
            className={`p-4 flex items-center justify-between cursor-pointer transition-shadow ${typeFilter === (isReseller ? 'wallet_voucher_sale' : 'commission_due') ? 'ring-2 ring-purple-400' : ''}`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-400">{isReseller ? 'Wallet Voucher Sales' : 'Commission Dues'}</p>
              <p className="text-xl font-extrabold text-purple-600 mt-1">
                {rs(isReseller ? (summary.total_wallet_voucher_sales ?? 0) : (summary.total_commission_due ?? 0))}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">{isReseller ? 'Wallet Package Voucher Revenue' : 'Outstanding Commission'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center shrink-0">
              <Wallet size={22} />
            </div>
          </GlassCard>

          {/* 3. Payment Collected (Load GB Wallet) */}
          <GlassCard
            onClick={() => toggleTypeFilter('payment')}
            className={`p-4 flex items-center justify-between cursor-pointer transition-shadow ${typeFilter === 'payment' ? 'ring-2 ring-emerald-400' : ''}`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-400">Payment Collected (Load GB Wallet)</p>
              <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary.total_paid)}</p>
              <p className="text-[11px] text-emerald-600 mt-1 font-medium">{isReseller ? 'Received from Sellers' : 'Received in Cash/Bank'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <Wallet size={22} />
            </div>
          </GlassCard>

          {/* 4. Receivable Dues (Load GB Wallet) */}
          <GlassCard
            onClick={() => toggleTypeFilter('due')}
            className={`p-4 flex items-center justify-between cursor-pointer transition-shadow ${typeFilter === 'due' ? 'ring-2 ring-amber-400' : ''}`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-400">Receivable Dues (Load GB Wallet)</p>
              <p className={`text-xl font-extrabold mt-1 ${summary.total_due > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {rs(summary.total_due)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 font-medium">{isReseller ? 'Owed by Sellers' : 'Receivable Dues'}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <DollarSign size={22} />
            </div>
          </GlassCard>
        </div>
      )}

      {typeFilter && (
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Filter size={14} />
          Filtered by:
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 flex items-center gap-1">
            {typeFilter === 'gb_voucher_sale' ? 'GB Voucher Sales'
              : typeFilter === 'payment' ? 'Payments'
              : typeFilter === 'due' ? 'Receivable Dues (Load GB Wallet)'
              : typeFilter === 'commission_due' ? 'Commission Dues'
              : typeFilter === 'voucher_sale' ? 'Commission Earned'
              : typeFilter === 'commission_paid' ? 'Commission Paid'
              : typeFilter}
            <button onClick={() => setTypeFilter('')} className="ml-1 hover:text-slate-900">✕</button>
          </span>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col lg:flex-row items-end gap-3 w-full">

        <div className="flex-1 w-full">
          <label className="text-[11px] font-bold text-slate-500 block mb-1">From Date</label>
          <DualDatePicker label="From Date" value={fromDate} onChange={(val) => setFromDate(val)} />
        </div>

        <div className="flex-1 w-full">
          <label className="text-[11px] font-bold text-slate-500 block mb-1">To Date</label>
          <DualDatePicker label="To Date" value={toDate} onChange={(val) => setToDate(val)} />
        </div>

        <div className="flex-1 w-full">
          <label className="text-[11px] font-bold text-slate-500 block mb-1">Search</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search account / reference..."
              className="input pl-9 text-xs w-full"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <button
          onClick={resetFilters}
          className="flex-1 w-full text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all h-[38px]"
        >
          <RefreshCw size={13} />
          Reset Filters
        </button>
      </div>

      {/* Itemized Sales Statement Table */}
      <GlassCard className="!p-0 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : ledger.data.length === 0 ? (
          <EmptyState title="No Ledger Entries Found" subtitle="Try adjusting your filters or date range." />
        ) : (
          <div className="flex flex-col">
            <div className="px-4 pb-4 border-b border-slate-100 bg-slate-50/30">
              <Pagination meta={ledger} onPage={setPage} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Reference</th>
                  <th>Invoiced (Rs)</th>
                  <th>Paid (Rs)</th>
                  {user?.role !== 'seller' && <th>Admin Share (Rs)</th>}
                  {user?.role !== 'seller' && <th>Reseller Share (Rs)</th>}
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((row: any, idx: number) => (
                  <motion.tr
                    key={`${row.type}-${row.id}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="hover:bg-slate-50/60"
                  >
                    <td className="whitespace-nowrap text-xs font-medium text-slate-600">{date(row.date)}</td>
                    <td className="whitespace-nowrap">
                      <div className="font-bold text-slate-800 text-xs">{row.user_name || row.party_name || 'User'}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">{row.user_role || 'ACCOUNT'}</div>
                    </td>
                    <td className="whitespace-nowrap">
                      {row.type === 'invoice' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-600 border border-blue-100 flex items-center gap-1 w-max">
                          <FileText size={11} /> Invoice
                        </span>
                      ) : row.type === 'wallet_load' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-600 border border-teal-100 flex items-center gap-1 w-max">
                          <Wallet size={11} /> Wallet Load
                        </span>
                      ) : row.type === 'voucher_sale' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-600 border border-purple-100 flex items-center gap-1 w-max">
                          <Tag size={11} /> Voucher Sale
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1 w-max">
                          <CheckCircle2 size={11} /> Payment
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs text-slate-600">{row.reference || '—'}</td>
                    <td className="whitespace-nowrap font-extrabold text-xs text-blue-600">
                      {(row.invoiced ?? (row.type === 'invoice' ? row.amount : 0)) > 0
                        ? rs(row.invoiced ?? row.amount)
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap font-extrabold text-xs text-emerald-600">
                      {(row.paid ?? (row.type === 'payment' ? row.amount : 0)) > 0
                        ? rs(row.paid ?? row.amount)
                        : '—'}
                    </td>
                    {user?.role !== 'seller' && (
                      <td className="whitespace-nowrap font-extrabold text-xs text-indigo-600">
                        {row.type === 'voucher_sale' ? rs(row.admin_share ?? 0) : '—'}
                      </td>
                    )}
                    {user?.role !== 'seller' && (
                      <td className="whitespace-nowrap font-extrabold text-xs text-slate-600">
                        {row.type === 'voucher_sale' ? rs(row.reseller_share ?? 0) : '—'}
                      </td>
                    )}
                    <td className="text-xs text-slate-500 max-w-sm whitespace-normal break-words">{row.note || row.title || '—'}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/30">
              <Pagination meta={ledger} onPage={setPage} />
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

/* ==========================================================================
   2. Operating Expenses Ledger View
   ========================================================================== */
function ExpensesLedgerView() {
  const [partyFilter, setPartyFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const [confirmDeleteExpenseId, setConfirmDeleteExpenseId] = useState<number | null>(null)

  const queryParams = new URLSearchParams()
  if (partyFilter) queryParams.set('party_id', partyFilter)
  if (categoryFilter) queryParams.set('category', categoryFilter)
  if (fromDate) queryParams.set('from_date', fromDate)
  if (toDate) queryParams.set('to_date', toDate)
  if (search) queryParams.set('search', search)
  queryParams.set('page', String(page))

  const { data: expenseData, loading, refetch: refetchExpenses } = useQuery<any>(
    `expenses?${queryParams.toString()}`,
    () => api.get(`/expenses?${queryParams.toString()}`).then((r) => r.data.data),
  )

  const { data: partiesList = [], refetch: refetchParties } = useQuery<any[]>(
    'parties',
    () => api.get('/parties').then((r) => r.data.data),
  )

  useEffect(() => {
    setPage(1)
  }, [partyFilter, categoryFilter, fromDate, toDate, search])

  const expenses = expenseData?.expenses?.data || expenseData?.data || []
  const summary = expenseData?.summary || { total_amount: 0, count: 0, by_category: {} }

  useEffect(() => {
    const handleRefetch = () => refetchExpenses()
    window.addEventListener('expense-added', handleRefetch)
    return () => window.removeEventListener('expense-added', handleRefetch)
  }, [refetchExpenses])

  const handleDeleteExpense = (id: number) => setConfirmDeleteExpenseId(id)

  const executeDeleteExpense = async () => {
    if (!confirmDeleteExpenseId) return
    try {
      await api.delete(`/expenses/${confirmDeleteExpenseId}`)
      invalidateCache('expenses')
      refetchExpenses()
    } catch (err: any) {
      alert(apiError(err))
    } finally {
      setConfirmDeleteExpenseId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Total Expenses</p>
            <p className="text-xl font-extrabold text-rose-600 mt-1">{rs(summary.total_amount)}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{summary.count} Records Recorded</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
            <Receipt size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Top Expenditure Category</p>
            <p className="text-sm font-extrabold text-slate-800 mt-1 capitalize">
              {Object.keys(summary.by_category || {}).sort((a, b) => summary.by_category[b] - summary.by_category[a])[0] || 'None'}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Largest Expense Allocation</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <Tag size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Registered Vendor Parties</p>
            <p className="text-xl font-extrabold text-slate-800 mt-1">{partiesList.length}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium font-medium">Active Beneficiaries</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
            <UserCheck size={22} />
          </div>
        </GlassCard>
      </div>

      {/* Expense List Table */}
      <GlassCard className="!p-0 overflow-hidden">
        {loading ? (
          <Spinner />
        ) : expenses.length === 0 ? (
          <EmptyState title="No Expense Records" subtitle="Click 'Add Expense' to record a new payment entry." />
        ) : (
          <div className="flex flex-col">
            <div className="px-4 pb-4 border-b border-slate-100 bg-slate-50/30">
              <Pagination meta={expenseData?.expenses} onPage={setPage} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Party / Vendor</th>
                  <th>Amount</th>
                  <th>Payment Method</th>
                  <th>Reference</th>
                  <th>Note</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp: any, idx: number) => (
                  <tr key={exp.id} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap text-xs font-medium text-slate-600">{date(exp.expense_date)}</td>
                    <td className="whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100 capitalize">
                        {exp.category}
                      </span>
                    </td>
                    <td className="whitespace-nowrap font-bold text-slate-800 text-xs">
                      {exp.party?.name || '—'}
                    </td>
                    <td className="whitespace-nowrap font-extrabold text-xs text-rose-600">{rs(exp.amount)}</td>
                    <td className="whitespace-nowrap text-xs text-slate-600 uppercase font-semibold">{exp.payment_method}</td>
                    <td className="whitespace-nowrap font-mono text-xs text-slate-600">{exp.reference || '—'}</td>
                    <td className="text-xs text-slate-500 max-w-sm whitespace-normal break-words">{exp.note || '—'}</td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDeleteExpense(exp.id)}
                        className="p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/30">
              <Pagination meta={expenseData?.expenses} onPage={setPage} />
            </div>
          </div>
        )}
      </GlassCard>

      <ConfirmModal
        open={confirmDeleteExpenseId !== null}
        onClose={() => setConfirmDeleteExpenseId(null)}
        onConfirm={executeDeleteExpense}
        title="Delete Expense Entry"
        message="Are you sure you want to delete this expense entry? This action cannot be undone."
        confirmText="Delete Entry"
      />
    </div>
  )
}

/* ==========================================================================
   3. Commission Report View
   ========================================================================== */
type CommissionPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

function CommissionReportView() {
  const { user } = useAuth()
  const [groupBy, setGroupBy] = useState<CommissionPeriod>('daily')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [collectTarget, setCollectTarget] = useState<{ id: number; name: string; username: string; commission_due: number } | null>(null)
  const [breakdownTab, setBreakdownTab] = useState<'graph' | 'list'>('graph')

  const queryParams = new URLSearchParams()
  queryParams.set('group_by', groupBy)
  if (fromDate) queryParams.set('from_date', fromDate)
  if (toDate) queryParams.set('to_date', toDate)

  const { data, loading, refetch } = useQuery<any>(
    `accounts/commission-report?${queryParams.toString()}`,
    () => api.get(`/accounts/commission-report?${queryParams.toString()}`).then((r) => r.data.data),
  )

  const rows = data?.rows || []
  const byReseller = data?.by_reseller || []
  const isCustomRange = !!(fromDate || toDate)

  const periodLabel = (p: string) => {
    if (groupBy === 'daily') return p.slice(5) // MM-DD
    if (groupBy === 'monthly') return p // YYYY-MM
    return p // YYYY, or YYYY-Www for weekly
  }

  const resetFilters = () => {
    setFromDate('')
    setToDate('')
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">{user?.role === 'admin' ? 'Commission Earned' : 'Commission Due'}</p>
            <p className="text-xl font-extrabold text-indigo-600 mt-1">{rs((user?.role === 'admin' ? data?.total_collected : data?.total_earned) || 0)}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">
              {user?.role === 'admin' ? 'Settled with resellers, this range' : 'Accrued on your voucher sales, this range'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
            <DollarSign size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">{user?.role === 'admin' ? 'Commission Collected' : 'Commission Paid to Admin'}</p>
            <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(data?.total_collected || 0)}</p>
            <p className="text-[11px] text-emerald-600 mt-1 font-medium">
              {user?.role === 'admin' ? 'Real settlements, this range' : 'Actually settled with admin, this range'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <CollectIcon size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">{user?.role === 'admin' ? 'Outstanding Commission' : 'Commission Due to Admin'}</p>
            <p className={`text-xl font-extrabold mt-1 ${(data?.total_outstanding || 0) > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
              {rs(data?.total_outstanding || 0)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Live balance, not yet settled</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <AlertCircle size={22} />
          </div>
        </GlassCard>
      </div>

      {/* Period Toggle + Custom Date Range */}
      <div className="flex flex-col lg:flex-row items-start lg:items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {(['daily', 'weekly', 'monthly', 'yearly'] as CommissionPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setGroupBy(p)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all capitalize ${
                groupBy === p
                  ? 'bg-[#003164] text-white border-[#003164] shadow-md shadow-[#003164]/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Calendar size={14} /> {p}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 lg:ml-auto">
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">From Date</label>
            <DualDatePicker label="From Date" value={fromDate} onChange={setFromDate} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">To Date</label>
            <DualDatePicker label="To Date" value={toDate} onChange={setToDate} />
          </div>
          {isCustomRange && (
            <button
              onClick={resetFilters}
              className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all h-[38px]"
            >
              <RefreshCw size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Earned vs Collected — Graph and List as separate tabs */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">{user?.role === 'admin' ? 'Commission Earned vs. Collected' : 'Commission Due vs. Paid'}</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isCustomRange
                ? 'Custom range'
                : groupBy === 'daily' ? 'Last 30 days'
                : groupBy === 'weekly' ? 'Last 12 weeks'
                : groupBy === 'monthly' ? 'Last 12 months'
                : 'Last 5 years'}
            </p>
          </div>
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
            <button
              onClick={() => setBreakdownTab('graph')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                breakdownTab === 'graph' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <BarChart3 size={13} /> Graph
            </button>
            <button
              onClick={() => setBreakdownTab('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                breakdownTab === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <ListIcon size={13} /> List
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="p-4"><Spinner /></div>
        ) : rows.length === 0 ? (
          <div className="p-4"><EmptyState title="No Commission Activity" subtitle="No vouchers with commission have been sold in this range." /></div>
        ) : breakdownTab === 'graph' ? (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={52} tickFormatter={(v) => `Rs ${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  labelFormatter={(p: any) => periodLabel(String(p))}
                  formatter={(v: any, name: any) => [`Rs ${Number(v).toLocaleString()}`, name]}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar name={user?.role === 'admin' ? 'Earned' : 'Due'} dataKey="earned" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar name={user?.role === 'admin' ? 'Collected' : 'Paid'} dataKey="collected" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-96">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>{user?.role === 'admin' ? 'Earned (Rs)' : 'Due (Rs)'}</th>
                  <th>{user?.role === 'admin' ? 'Collected (Rs)' : 'Paid (Rs)'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice().reverse().map((r: any) => (
                  <tr key={r.period} className="hover:bg-slate-50/50">
                    <td className="whitespace-nowrap text-xs font-semibold text-slate-600">{periodLabel(r.period)}</td>
                    <td className="whitespace-nowrap font-bold text-indigo-600 text-xs">{rs(r.earned)}</td>
                    <td className="whitespace-nowrap font-bold text-emerald-600 text-xs">{rs(r.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Outstanding Commission by Reseller — admin only, with Collect action */}
      {user?.role === 'admin' && (
        <GlassCard className="!p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="font-extrabold text-slate-800 text-sm">Outstanding Commission by Reseller</h3>
            <p className="text-xs text-slate-400 mt-0.5">Live balances — record a settlement as it's actually paid in cash/bank</p>
          </div>
          {byReseller.length === 0 ? (
            <EmptyState title="No Resellers" subtitle="No resellers found." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Reseller</th>
                    <th>Total Earned (All-Time)</th>
                    <th>Outstanding Due</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {byReseller.map((r: any) => (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="whitespace-nowrap">
                        <div className="font-bold text-slate-800 text-xs">{r.name}</div>
                        <div className="text-[10px] font-mono text-slate-400">{r.username}</div>
                      </td>
                      <td className="whitespace-nowrap font-bold text-indigo-600 text-xs">{rs(r.total_earned_all_time)}</td>
                      <td className="whitespace-nowrap font-bold text-xs">
                        {r.commission_due > 0 ? <span className="text-amber-600">{rs(r.commission_due)}</span> : <span className="text-slate-400">Settled</span>}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          disabled={r.commission_due <= 0}
                          onClick={() => setCollectTarget(r)}
                          className="px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold transition-all"
                        >
                          Collect Commission
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      <CollectCommissionModal target={collectTarget} onClose={() => setCollectTarget(null)} onCollected={() => { refetch(); invalidateCache('accounts/sales-ledger') }} />
    </div>
  )
}

function CollectCommissionModal({
  target, onClose, onCollected,
}: { target: { id: number; name: string; username: string; commission_due: number } | null; onClose: () => void; onCollected: () => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [method, setMethod] = useState('CASH')
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

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
    if (target) {
      setAmount(String(target.commission_due))
      setNote('')
      setMethod('CASH')
      setErrorMsg('')
    }
  }, [target])

  if (!target) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const rawAmount = Number(String(amount).replace(/,/g, ''))
    if (!rawAmount || rawAmount <= 0) {
      setErrorMsg('Please enter a valid amount.')
      return
    }
    try {
      setBusy(true)
      setErrorMsg('')
      await api.post('/billing/commission/collect', { user_id: target.id, amount: rawAmount, note: note || undefined, payment_method: method })
      onCollected()
      onClose()
    } catch (err: any) {
      setErrorMsg(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!target} onClose={onClose} title="Collect Commission Payment" subtitle={`From ${target.name} (${target.username})`} icon={<CollectIcon size={20} />}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && <div className="p-3 text-xs bg-rose-50 border border-rose-100 text-rose-600 rounded-xl font-bold">{errorMsg}</div>}

        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs font-semibold text-amber-700">
          Outstanding commission due: <strong>{rs(target.commission_due)}</strong>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">Amount Received (Rs)</label>
          <input
            type="text"
            required
            className="input text-xs font-semibold"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">Payment Method</label>
          <CustomSelect
            className="w-full"
            value={method}
            onChange={(val) => setMethod(String(val))}
            options={paymentMethods}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">Note (optional)</label>
          <textarea
            rows={2}
            placeholder="e.g. Paid via bank transfer on..."
            className="input text-xs"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs font-bold py-2 px-4 rounded-xl">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-xs font-bold py-2 px-4 rounded-xl">{busy ? 'Recording...' : 'Record Payment'}</button>
        </div>
      </form>
    </Modal>
  )
}

/* ==========================================================================
   4. All Transactions Audit View
   ========================================================================== */
type SourceFilter = '' | 'wallet' | 'gb' | 'invoice' | 'payment'

const FILTERS: { key: SourceFilter; label: string; icon: any }[] = [
  { key: '', label: 'All Activities', icon: ArrowLeftRight },
  { key: 'gb', label: 'GB Transfers', icon: Database },
  { key: 'invoice', label: 'Invoices', icon: FileText },
  { key: 'payment', label: 'Payments', icon: HandCoins },
  { key: 'wallet', label: 'Wallet Logs', icon: Wallet },
]

function TransactionsAuditView() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [source, setSource] = useState<SourceFilter>('')

  const { data, loading } = useQuery(
    `transactions?page=${page}&source=${source}`,
    () => api.get('/transactions', { params: { page, source: source || undefined } }).then((r) => r.data.data),
  )

  return (
    <div className="space-y-4">
      {/* Source Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = source === f.key
          return (
            <button
              key={f.key || 'all'}
              onClick={() => { setSource(f.key); setPage(1) }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all ${
                active
                  ? 'bg-[#003164] text-white border-[#003164] shadow-md shadow-[#003164]/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <f.icon size={14} /> {f.label}
            </button>
          )
        })}
      </div>

      {/* Transactions Audit Table */}
      <GlassCard className="!p-0 overflow-hidden">
        {loading && !data ? (
          <Spinner />
        ) : (
          <div className="flex flex-col">
            <div className="px-4 pb-4 border-b border-slate-100 bg-slate-50/30">
              <Pagination meta={data} onPage={setPage} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Type / Source</th>
                  <th>Amount</th>
                  <th>Balance After</th>
                  <th>Counterparty</th>
                  <th>Reference / Note</th>
                </tr>
              </thead>
              <tbody>
                {(data?.data || []).map((t: any, idx: number) => (
                  <motion.tr
                    key={`${t.source}-${t.source_id}-${idx}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="hover:bg-slate-50/60"
                  >
                    <td className="whitespace-nowrap text-xs font-medium text-slate-600">{datet(t.created_at)}</td>
                    <td className="whitespace-nowrap font-mono text-xs font-bold text-slate-800">
                      {t.account || '—'}
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#003164]/10 text-[#003164] border border-[#003164]/20 uppercase">
                        {t.source} · {t.type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap font-extrabold text-xs text-slate-800">
                      {t.unit === 'gb' ? gb(t.amount) : rs(t.amount)}
                    </td>
                    <td className="whitespace-nowrap text-xs font-medium text-slate-500">
                      {t.balance_after !== null && t.balance_after !== undefined ? (t.unit === 'gb' ? gb(t.balance_after) : rs(t.balance_after)) : '—'}
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs text-slate-600">
                      {t.from && t.to ? `${t.from} → ${t.to}` : (t.from || t.to || '—')}
                    </td>
                    <td className="text-xs text-slate-500 max-w-sm whitespace-normal break-words">{t.reference || t.note || '—'}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="px-4 pb-4 border-t border-slate-100 bg-slate-50/30">
              <Pagination meta={data} onPage={setPage} />
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

function GlobalAddExpenseModal() {
  const [modalOpen, setModalOpen] = useState(false)
  const [expenseForm, setExpenseForm] = useState({
    id: null as number | null,
    party_id: '',
    category: 'other',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    payment_method: 'cash',
    reference: '',
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    const handleOpen = () => {
      setExpenseForm({
        id: null,
        party_id: '',
        category: 'other',
        amount: '',
        expense_date: new Date().toISOString().split('T')[0],
        payment_method: 'cash',
        reference: '',
        note: '',
      })
      setErrorMsg('')
      setModalOpen(true)
    }
    window.addEventListener('open-add-expense', handleOpen)
    return () => window.removeEventListener('open-add-expense', handleOpen)
  }, [])

  const formatPriceWithCommas = (val: string) => {
    const clean = val.replace(/[^0-9.]/g, '')
    if (!clean) return ''
    const parts = clean.split('.')
    const formattedInteger = Number(parts[0]).toLocaleString('en-IN')
    if (parts.length > 1) {
      return `${formattedInteger}.${parts[1].slice(0, 2)}`
    }
    return formattedInteger
  }

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    const rawAmount = String(expenseForm.amount).replace(/,/g, '')
    if (!rawAmount || Number(rawAmount) <= 0) {
      setErrorMsg('Please enter a valid expense amount.')
      return
    }
    const payload = {
      ...expenseForm,
      amount: rawAmount,
    }
    try {
      setBusy(true)
      setErrorMsg('')
      if (expenseForm.id) {
        await api.put(`/expenses/${expenseForm.id}`, payload)
      } else {
        await api.post('/expenses', payload)
      }
      invalidateCache('expenses')
      setModalOpen(false)
      window.dispatchEvent(new Event('expense-added'))
    } catch (err: any) {
      setErrorMsg(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record New Expense">
      <form onSubmit={handleSaveExpense} className="space-y-4">
        {errorMsg && <div className="p-3 text-xs bg-rose-50 border border-rose-100 text-rose-600 rounded-xl font-bold">{errorMsg}</div>}
        
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">Expense Category</label>
          <Combobox
            value={expenseForm.category}
            onChange={(val) => setExpenseForm({ ...expenseForm, category: String(val) })}
            options={EXPENSE_CATEGORIES}
            placeholder="Select Category..."
            searchable
            className="w-full"
          />
        </div>

        {/* 3-Column Row: Amount, Expense Date, Payment Method */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Amount (Rs)</label>
            <input
              type="text"
              required
              placeholder="e.g. 50,000"
              className="input text-xs font-semibold"
              value={expenseForm.amount}
              onChange={(e) => {
                const formatted = formatPriceWithCommas(e.target.value)
                setExpenseForm({ ...expenseForm, amount: formatted })
              }}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Expense Date</label>
            <DualDatePicker label="Expense Date" value={expenseForm.expense_date} onChange={(val) => setExpenseForm({ ...expenseForm, expense_date: val })} />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 block mb-1">Payment Method</label>
            <Combobox
              value={expenseForm.payment_method}
              onChange={(val) => setExpenseForm({ ...expenseForm, payment_method: String(val) })}
              options={PAYMENT_METHODS}
              placeholder="Select Payment Method..."
              searchable={false}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">Reference / Voucher No.</label>
          <input
            type="text"
            placeholder="e.g. BILL-9921"
            className="input text-xs"
            value={expenseForm.reference}
            onChange={(e) => setExpenseForm({ ...expenseForm, reference: e.target.value })}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1">Remarks / Note</label>
          <textarea
            rows={2}
            placeholder="Add additional remarks or notes..."
            className="input text-xs"
            value={expenseForm.note}
            onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-xs font-bold py-2 px-4 rounded-xl">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-xs font-bold py-2 px-4 rounded-xl">{busy ? 'Saving...' : 'Save Expense'}</button>
        </div>
      </form>
    </Modal>
  )
}
