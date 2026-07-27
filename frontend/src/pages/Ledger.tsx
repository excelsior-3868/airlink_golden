import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, Receipt, ArrowLeftRight, TrendingUp, Wallet, DollarSign,
  Plus, Filter, RefreshCw, Search, Users, FileText, CheckCircle2, AlertCircle,
  Database, HandCoins, ArrowUpRight, ArrowDownLeft, Trash2, Edit3, Tag, Calendar, UserCheck, Activity
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, datet, date } from '../lib/format'
import { GlassCard, PageTitle, Pill, Pagination, EmptyState, Spinner, Modal, Combobox, SelectOption, ConfirmModal } from '../components/ui'
import { DualDatePicker } from '../components/DualDatePicker'
import RadiusLogs from './RadiusLogs'

// Sub-Tab Types
type LedgerTab = 'sales' | 'expenses' | 'transactions'

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
    ['sales', 'expenses', 'transactions'].includes(currentTabParam) ? currentTabParam : 'sales'
  )

  useEffect(() => {
    const tabParam = (searchParams.get('tab') as LedgerTab) || 'sales'
    if (['sales', 'expenses', 'transactions'].includes(tabParam)) {
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
          <button
            onClick={() => window.dispatchEvent(new Event('open-add-expense'))}
            className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 rounded-xl font-bold shadow-md shadow-blue-600/20"
          >
            <Plus size={15} /> Add Expense
          </button>
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
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [targetUserId, setTargetUserId] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [page, setPage] = useState<number>(1)

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

  return (
    <div className="space-y-6">
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Total Invoiced Sales</p>
            <p className="text-xl font-extrabold text-blue-600 mt-1">{rs(summary.total_invoiced)}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{gb(summary.total_gb)} Allocated</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
            <TrendingUp size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Payments Collected</p>
            <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary.total_paid)}</p>
            <p className="text-[11px] text-emerald-600 mt-1 font-medium">Received in Cash/Bank</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <Wallet size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Outstanding Balance</p>
            <p className={`text-xl font-extrabold mt-1 ${summary.total_due > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
              {rs(summary.total_due)}
            </p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Receivable Dues</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <DollarSign size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Accounts Active</p>
            <p className="text-xl font-extrabold text-slate-800 mt-1">{userSummaries.length}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{user?.role === 'admin' ? 'Resellers' : 'Resellers & Sellers'}</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center shrink-0">
            <Users size={22} />
          </div>
        </GlassCard>
      </div>

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
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Detailed Sales Ledger Statements</h3>
            <p className="text-xs text-slate-400 mt-0.5">Itemized statement of GB allocations, voucher sales, and cash collections</p>
          </div>
        </div>

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
                  <th>Balance (Rs)</th>
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
                    <td className="whitespace-nowrap font-extrabold text-xs text-slate-800">
                      {rs(row.running_balance ?? row.due_amount ?? 0)}
                    </td>
                    <td className="text-xs text-slate-500 max-w-xs truncate">{row.note || row.title || '—'}</td>
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
                    <td className="text-xs text-slate-500 max-w-xs truncate">{exp.note || '—'}</td>
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
   3. All Transactions Audit View
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
                    <td className="text-xs text-slate-500 max-w-xs truncate">{t.reference || t.note || '—'}</td>
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
