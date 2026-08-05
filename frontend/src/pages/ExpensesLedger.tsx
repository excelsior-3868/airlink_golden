import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Receipt, Plus, Filter, RefreshCw, Search, UserCheck, DollarSign,
  Calendar, CreditCard, Save, Trash2, Edit3, Tag, FileText, CheckCircle2, Users
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, date } from '../lib/format'
import { GlassCard, PageTitle, Modal, Pill, Pagination, EmptyState, Spinner, Combobox, SelectOption, ConfirmModal, renderPaymentMethodIcon } from '../components/ui'
import { DualDatePicker } from '../components/DualDatePicker'

const CATEGORIES = [
  { value: 'salary', label: 'Salary & Compensation' },
  { value: 'bandwidth', label: 'Bandwidth (BW)' },
  { value: 'equipment', label: 'Equipment & Hardware' },
  { value: 'rent', label: 'Office & Tower Rent' },
  { value: 'maintenance', label: 'Maintenance & Repairs' },
  { value: 'utility', label: 'Utilities (Electricity/Water)' },
  { value: 'marketing', label: 'Marketing & Sales' },
  { value: 'other', label: 'Other Expenses' },
]

const PAYMENT_METHODS: SelectOption[] = [
  { value: 'CASH', label: 'Cash', icon: renderPaymentMethodIcon('💵', 'CASH') },
  { value: 'QR_ESEWA', label: 'eSewa', icon: renderPaymentMethodIcon('🟢', 'QR_ESEWA') },
  { value: 'QR_KHALTI', label: 'Khalti', icon: renderPaymentMethodIcon('🚀', 'QR_KHALTI') },
  { value: 'CARD', label: 'Card', icon: renderPaymentMethodIcon('💳', 'CARD') },
  { value: 'FONEPAY_QR', label: 'Fonepay QR', icon: renderPaymentMethodIcon('📲', 'FONEPAY_QR') },
]

export default function ExpensesLedger() {
  const { user } = useAuth()
  const [partyFilter, setPartyFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [page, setPage] = useState<number>(1)

  // Expense Modal State
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [editExpense, setEditExpense] = useState<any>(null)
  const [expenseForm, setExpenseForm] = useState({
    party_id: '',
    party_name: '',
    category: 'salary',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    payment_method: 'CASH',
    reference: '',
    note: '',
  })

  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [dynamicPaymentMethods, setDynamicPaymentMethods] = useState<SelectOption[]>(PAYMENT_METHODS)

  useEffect(() => {
    api.get('/payment-methods').then((res) => {
      if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        setDynamicPaymentMethods(
          res.data.data.map((pm: any) => ({
            value: pm.code,
            label: pm.label,
            icon: renderPaymentMethodIcon(pm.icon, pm.code),
          }))
        )
      }
    }).catch(() => {})
  }, [])

  // Query Expenses
  const queryParams = new URLSearchParams()
  if (partyFilter) queryParams.set('party_id', partyFilter)
  if (categoryFilter) queryParams.set('category', categoryFilter)
  if (fromDate) queryParams.set('from_date', fromDate)
  if (toDate) queryParams.set('to_date', toDate)
  if (search) queryParams.set('search', search)
  queryParams.set('page', String(page))

  const { data: expensesData, loading, refetch: refetchExpenses } = useQuery<any>(
    `accounts/expenses?${queryParams.toString()}`,
    () => api.get(`/accounts/expenses?${queryParams.toString()}`).then((r) => r.data.data),
  )

  // Query Users (Resellers & Sellers) to load in place of Parties/Vendors
  const { data: usersList = [] } = useQuery<any[]>(
    'users?per_page=500',
    () => api.get('/users', { params: { per_page: 500 } }).then((r) => r.data.data?.data || r.data.data || []),
  )

  useEffect(() => {
    setPage(1)
  }, [partyFilter, categoryFilter, fromDate, toDate, search])

  const summary = expensesData?.summary || { total_amount: 0, total_count: 0, categories: [], parties: [] }
  const expenses = expensesData?.expenses || { data: [], current_page: 1, last_page: 1, total: 0 }

  const resetFilters = () => {
    setPartyFilter('')
    setCategoryFilter('')
    setFromDate('')
    setToDate('')
    setSearch('')
    setPage(1)
  }

  // Open Create/Edit Expense Modal
  const openCreateExpense = () => {
    setEditExpense(null)
    setExpenseForm({
      party_id: '',
      party_name: '',
      category: 'salary',
      amount: '',
      expense_date: new Date().toISOString().split('T')[0],
      payment_method: 'cash',
      reference: '',
      note: '',
    })
    setErr('')
    setExpenseModalOpen(true)
  }

  const openEditExpenseModal = (exp: any) => {
    setEditExpense(exp)
    setExpenseForm({
      party_id: exp.party_id ? String(exp.party_id) : '',
      party_name: exp.party_name || '',
      category: exp.category || 'other',
      amount: String(exp.amount),
      expense_date: exp.expense_date ? exp.expense_date.split('T')[0] : new Date().toISOString().split('T')[0],
      payment_method: exp.payment_method || 'cash',
      reference: exp.reference || '',
      note: exp.note || '',
    })
    setErr('')
    setExpenseModalOpen(true)
  }

  // Save Expense (Create or Update)
  const saveExpense = async () => {
    if (!expenseForm.amount || +expenseForm.amount <= 0) {
      setErr('Please enter a valid expense amount.')
      return
    }
    if (!expenseForm.expense_date) {
      setErr('Please select an expense date.')
      return
    }

    setBusy(true)
    setErr('')
    try {
      if (editExpense) {
        await api.put(`/accounts/expenses/${editExpense.id}`, expenseForm)
      } else {
        await api.post('/accounts/expenses', expenseForm)
      }
      setExpenseModalOpen(false)
      refetchExpenses()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })

  // Delete Expense
  const deleteExpense = (id: number) => {
    setConfirmDelete({ open: true, id })
  }

  // Combobox Options
  const accountFilterOptions: SelectOption[] = [
    { value: '', label: 'All Accounts (Resellers & Sellers)' },
    ...(usersList || []).map((u: any) => ({
      value: String(u.id),
      label: `${u.name} (${u.username})`,
      badge: <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{u.role}</span>,
    })),
  ]

  const accountModalOptions: SelectOption[] = [
    { value: '', label: '-- Custom / General Party --' },
    ...(usersList || []).map((u: any) => ({
      value: String(u.id),
      label: `${u.name} (${u.username})`,
      badge: <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{u.role}</span>,
    })),
  ]

  const categoryFilterOptions: SelectOption[] = [
    { value: '', label: 'All Categories' },
    ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
  ]

  const categoryModalOptions: SelectOption[] = CATEGORIES.map((c) => ({ value: c.value, label: c.label }))

  const paymentMethodOptions: SelectOption[] = dynamicPaymentMethods

  return (
    <div className="space-y-6">
      <PageTitle
        title="Expenses Ledger"
        subtitle="Manage operational expenses, salaries, bandwidth & equipment costs by reseller & seller"
        icon={<Receipt size={22} className="text-emerald-600" />}
        action={
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={openCreateExpense}
            className="btn-primary flex items-center gap-2 py-2.5 px-5 rounded-2xl font-bold shadow-md"
          >
            <Plus size={16} />
            New Expense
          </motion.button>
        }
      />

      {/* Filter Toolbar */}
      <GlassCard className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-700">
            <Filter size={16} className="text-emerald-500" />
            <span>Filter Expenses Ledger</span>
          </div>
          <button
            onClick={resetFilters}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all"
          >
            <RefreshCw size={13} />
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* Category Filter */}
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Category</label>
            <Combobox
              value={categoryFilter}
              onChange={(val) => setCategoryFilter(val)}
              options={categoryFilterOptions}
              placeholder="All Categories"
              className="w-full"
              searchable
            />
          </div>

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
                placeholder="Reference / Note..."
                className="input pl-9 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Total Expenses</p>
            <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(summary.total_amount)}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{summary.total_count || 0} Records</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <Receipt size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Top Category</p>
            <p className="text-base font-extrabold text-slate-800 mt-1 capitalize truncate max-w-[150px]">
              {summary.categories[0]?.category || 'N/A'}
            </p>
            <p className="text-[11px] text-slate-500 font-bold mt-1">
              {summary.categories[0] ? rs(summary.categories[0].amount) : 'Rs 0.00'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
            <Tag size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Top Account Expense</p>
            <p className="text-base font-extrabold text-slate-800 mt-1 truncate max-w-[150px]">
              {summary.parties[0]?.party_name || 'N/A'}
            </p>
            <p className="text-[11px] text-purple-600 font-bold mt-1">
              {summary.parties[0] ? rs(summary.parties[0].amount) : 'Rs 0.00'}
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center shrink-0">
            <Users size={22} />
          </div>
        </GlassCard>

        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400">Total Accounts</p>
            <p className="text-xl font-extrabold text-amber-600 mt-1">{usersList.length}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-medium">Resellers & Sellers</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center shrink-0">
            <Users size={22} />
          </div>
        </GlassCard>
      </div>

      {/* Expenses Table */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Expenses Records</h3>
            <p className="text-xs text-slate-400">Detailed list of operating and capital expenses</p>
          </div>
          {loading && <Spinner />}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Reseller / Seller / Party</th>
                <th>Amount (Rs)</th>
                <th>Payment Method</th>
                <th>Reference / Note</th>
                <th>Recorded By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(expenses.data || []).map((exp: any) => (
                <tr key={exp.id} className="hover:bg-slate-50/50">
                  <td className="text-xs font-mono text-slate-600">{date(exp.expense_date)}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 capitalize border border-slate-200">
                      {exp.category}
                    </span>
                  </td>
                  <td className="font-semibold text-slate-800">
                    <div>{exp.party_name || exp.party?.name || 'General'}</div>
                  </td>
                  <td className="font-extrabold text-rose-600">{rs(exp.amount)}</td>
                  <td>
                    <span className="text-xs font-semibold text-slate-600 capitalize">{exp.payment_method.replace('_', ' ')}</span>
                  </td>
                  <td className="text-xs text-slate-500">
                    {exp.reference && <div className="font-mono font-semibold text-slate-700">{exp.reference}</div>}
                    {exp.note && <div className="italic text-slate-400 max-w-xs truncate">{exp.note}</div>}
                  </td>
                  <td className="text-xs text-slate-500">{exp.creator?.name || exp.creator?.username || 'Admin'}</td>
                  <td className="text-right pr-6 whitespace-nowrap">
                    <button
                      onClick={() => openEditExpenseModal(exp)}
                      className="p-1.5 text-sky-600 hover:text-sky-800 hover:bg-sky-50 rounded-lg transition-all mr-1"
                      title="Edit Expense"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => deleteExpense(exp.id)}
                      className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-all"
                      title="Delete Expense"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(expenses.data || []).length === 0 && <EmptyState>No expense records found.</EmptyState>}
        </div>

        <div className="p-4 border-t border-slate-100">
          <Pagination meta={expenses} onPage={setPage} />
        </div>
      </GlassCard>

      {/* Add / Edit Expense Modal */}
      <Modal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        title={editExpense ? 'Edit Expense Record' : 'Record New Expense'}
        subtitle="Log operational costs including salaries, bandwidth fees, and equipment purchase"
        icon={<Receipt size={22} className="text-emerald-600" />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Reseller / Seller Select */}
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Reseller / Seller Account</label>
              <Combobox
                value={expenseForm.party_id}
                onChange={(val) => {
                  const chosen = usersList.find((u) => String(u.id) === val)
                  setExpenseForm({
                    ...expenseForm,
                    party_id: val,
                    party_name: chosen ? chosen.name : expenseForm.party_name,
                  })
                }}
                options={accountModalOptions}
                placeholder="-- Custom / General Party --"
                searchable
              />
            </div>

            {/* Custom Party Name */}
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Custom Party Name (if not in accounts)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Nepal Telecom / Employee Name"
                value={expenseForm.party_name}
                onChange={(e) => setExpenseForm({ ...expenseForm, party_name: e.target.value })}
              />
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Expense Category</label>
              <Combobox
                value={expenseForm.category}
                onChange={(val) => setExpenseForm({ ...expenseForm, category: val })}
                options={categoryModalOptions}
                searchable
              />
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Amount (Rs.)</label>
              <input
                type="text"
                inputMode="decimal"
                className="input no-spinners"
                placeholder="e.g. 25000.00"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
              />
            </div>

            {/* Expense Date */}
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Expense Date</label>
              <DualDatePicker
                label="Expense Date"
                value={expenseForm.expense_date}
                onChange={(val) => setExpenseForm({ ...expenseForm, expense_date: val })}
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Payment Method</label>
              <Combobox
                className="w-full"
                value={expenseForm.payment_method}
                onChange={(val) => setExpenseForm({ ...expenseForm, payment_method: val })}
                options={paymentMethodOptions}
                searchable
              />
            </div>

            {/* Reference */}
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Invoice / Receipt Reference</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Bill # 1042 / Voucher Ref"
                value={expenseForm.reference}
                onChange={(e) => setExpenseForm({ ...expenseForm, reference: e.target.value })}
              />
            </div>

            {/* Note */}
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-500 block mb-1.5">Notes / Description</label>
              <textarea
                className="input py-2"
                rows={2}
                placeholder="e.g. Monthly bandwidth uplink fee for July..."
                value={expenseForm.note}
                onChange={(e) => setExpenseForm({ ...expenseForm, note: e.target.value })}
              />
            </div>
          </div>

          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold"
              onClick={() => setExpenseModalOpen(false)}
            >
              Cancel
            </button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              disabled={busy}
              onClick={saveExpense}
              className="btn-primary flex items-center gap-2 py-2.5 px-6 rounded-2xl font-bold shadow-md"
            >
              {busy ? (
                <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <Save size={16} />
              )}
              {busy ? 'Saving...' : editExpense ? 'Update Expense' : 'Save Expense'}
            </motion.button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete.open}
        onClose={() => setConfirmDelete({ open: false, id: null })}
        onConfirm={async () => {
          if (!confirmDelete.id) return
          try {
            await api.delete(`/accounts/expenses/${confirmDelete.id}`)
            refetchExpenses()
          } catch (e: any) {
            setErr(apiError(e))
          }
        }}
        title="Delete Expense Record"
        message="Are you sure you want to delete this expense record?"
        confirmText="Delete Expense"
      />
    </div>
  )
}
