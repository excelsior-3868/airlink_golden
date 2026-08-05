import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, Plus, ChevronDown, ChevronRight, Edit3, Trash2, Shield, Layers, CheckCircle2, AlertCircle
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { PageTitle, GlassCard, Spinner, Modal, Combobox, SelectOption } from '../components/ui'
import { ConfirmModal } from '../components/ConfirmModal'

const ACCOUNT_TYPES: SelectOption[] = [
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
]

const CATEGORY_MAP: Record<string, SelectOption[]> = {
  ASSET: [
    { value: 'CURRENT_ASSETS', label: 'Current Assets' },
    { value: 'NON_CURRENT_ASSETS', label: 'Non-Current Assets / Fixed Assets' },
  ],
  LIABILITY: [
    { value: 'CURRENT_LIABILITIES', label: 'Current Liabilities' },
    { value: 'LONG_TERM_LIABILITIES', label: 'Long-Term Liabilities' },
  ],
  EQUITY: [
    { value: 'OWNER_EQUITY', label: 'Owner Equity' },
    { value: 'RETAINED_EARNINGS', label: 'Retained Earnings' },
  ],
  INCOME: [
    { value: 'OPERATING_REVENUE', label: 'Operating Revenue' },
    { value: 'OTHER_INCOME', label: 'Other Income' },
  ],
  EXPENSE: [
    { value: 'OPERATING_EXPENSES', label: 'Operating Expenses' },
    { value: 'DIRECT_COSTS', label: 'Direct Costs / Cost of Goods Sold' },
  ],
}

interface AccountForm {
  id?: number
  code: string
  name: string
  type: string
  category: string
  description: string
}

export default function ChartOfAccounts() {
  const { data: d, loading, refetch } = useQuery<any>(
    'chart-of-accounts',
    () => api.get('/accounts/chart-of-accounts').then((r) => r.data.data)
  )

  const [modalOpen, setModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<AccountForm | null>(null)
  const [form, setForm] = useState<AccountForm>({
    code: '',
    name: '',
    type: 'ASSET',
    category: 'CURRENT_ASSETS',
    description: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  // Expand state for groups
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    ASSETS_CURRENT_ASSETS: true,
    LIABILITIES_CURRENT_LIABILITIES: true,
    EQUITY_OWNER_EQUITY: true,
    INCOME_OPERATING_REVENUE: true,
    EXPENSES_OPERATING_EXPENSES: true,
  })

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleOpenAdd = () => {
    setEditItem(null)
    setForm({
      code: '',
      name: '',
      type: 'ASSET',
      category: 'CURRENT_ASSETS',
      description: '',
    })
    setError('')
    setModalOpen(true)
  }

  const handleOpenEdit = (acct: any) => {
    setEditItem(acct)
    setForm({
      id: acct.id,
      code: acct.code,
      name: acct.name,
      type: acct.type,
      category: acct.category,
      description: acct.description || '',
    })
    setError('')
    setModalOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (editItem?.id) {
        await api.put(`/accounts/chart-of-accounts/${editItem.id}`, form)
      } else {
        await api.post('/accounts/chart-of-accounts', form)
      }
      invalidateCache('chart-of-accounts')
      refetch()
      setModalOpen(false)
    } catch (err: any) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setBusy(true)
    try {
      await api.delete(`/accounts/chart-of-accounts/${deleteId}`)
      invalidateCache('chart-of-accounts')
      refetch()
      setDeleteId(null)
    } catch (err: any) {
      alert(apiError(err))
    } finally {
      setBusy(false)
    }
  }


  const grouped = d?.grouped || {}

  const SECTIONS = [
    { key: 'ASSETS', label: 'Assets', items: grouped.ASSETS || [] },
    { key: 'LIABILITIES', label: 'Liabilities', items: grouped.LIABILITIES || [] },
    { key: 'EQUITY', label: 'Equity', items: grouped.EQUITY || [] },
    { key: 'INCOME', label: 'Income', items: grouped.INCOME || [] },
    { key: 'EXPENSES', label: 'Expenses', items: grouped.EXPENSES || [] },
  ]

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <PageTitle
        title="Chart of Accounts"
        subtitle="Financial ledger structure, categories, and account numbering"
        icon={<BookOpen size={22} className="text-blue-600" />}
        action={
          <button
            type="button"
            onClick={handleOpenAdd}
            className="btn-primary text-xs py-2.5 px-4 flex items-center gap-2 rounded-xl font-bold shadow-md shadow-blue-900/20 bg-[#003164] hover:bg-[#00254c] text-white"
          >
            <Plus size={16} /> Add Account
          </button>
        }
      />

      {loading ? (
        <Spinner />
      ) : (
        <GlassCard className="p-6 bg-white space-y-8">
          {SECTIONS.map((sec) => {
            // Group items inside section by category
            const categoryGroups = (sec.items as any[]).reduce((acc: any, acct: any) => {
              const cat = acct.category || 'General'
              if (!acc[cat]) acc[cat] = []
              acc[cat].push(acct)
              return acc
            }, {})

            const hasAccounts = sec.items.length > 0

            return (
              <div key={sec.key} className="space-y-4">
                <h2 className="text-sm font-semibold tracking-tight text-slate-800 border-b border-slate-100 pb-2">
                  {sec.label}
                </h2>

                {!hasAccounts ? (
                  <p className="text-xs text-slate-400 italic pl-4">No accounts yet</p>
                ) : (
                  Object.keys(categoryGroups).map((catKey) => {
                    const groupItems = categoryGroups[catKey]
                    const groupExpandKey = `${sec.key}_${catKey}`
                    const isExpanded = expandedGroups[groupExpandKey] !== false

                    const catLabel = catKey
                      .replace(/_/g, ' ')
                      .toLowerCase()
                      .replace(/\b\w/g, (l) => l.toUpperCase())

                    return (
                      <div key={catKey} className="space-y-2">
                        {/* Group Header */}
                        <div
                          onClick={() => toggleGroup(groupExpandKey)}
                          className="flex items-center justify-between cursor-pointer group py-1.5 px-2 hover:bg-slate-50 rounded-xl transition-all"
                        >
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                            {isExpanded ? (
                              <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-700" />
                            ) : (
                              <ChevronRight size={14} className="text-slate-400 group-hover:text-slate-700" />
                            )}
                            <span className="font-semibold text-slate-700">{catLabel}</span>
                          </div>


                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <Edit3 size={13} className="text-slate-400 hover:text-blue-600" />
                          </div>
                        </div>

                        {/* Account Items List */}
                        {isExpanded && (
                          <div className="pl-6 space-y-1">
                            {groupItems.map((acct: any) => (
                              <div
                                key={acct.id}
                                className="flex items-center justify-between py-2.5 px-4 rounded-xl hover:bg-slate-50/80 transition-all border border-transparent hover:border-slate-100 group"
                              >
                                <div className="flex items-center gap-4">
                                  <span className="font-mono text-xs font-semibold text-slate-400 w-12">{acct.code}</span>
                                  <span className="text-xs font-semibold text-slate-700">{acct.name}</span>

                                  {acct.is_system && (
                                    <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                                      System Default
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(acct)}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                    title="Edit Account"
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  {!acct.is_system && (
                                    <button
                                      type="button"
                                      onClick={() => setDeleteId(acct.id)}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                      title="Delete Account"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </GlassCard>
      )}

      {/* Add / Edit Account Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editItem ? 'Edit Financial Account' : 'Add New Financial Account'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-medium flex items-center gap-2">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Account Code</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                placeholder="e.g. 1300"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none font-mono font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Account Title</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Petty Cash"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Account Type</label>
              <Combobox
                options={ACCOUNT_TYPES}
                value={form.type}
                onChange={(val) => {
                  const defaultCat = CATEGORY_MAP[val]?.[0]?.value || 'CURRENT_ASSETS'
                  setForm((prev) => ({ ...prev, type: val, category: defaultCat }))
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Category Classification</label>
              <Combobox
                options={CATEGORY_MAP[form.type] || []}
                value={form.category}
                onChange={(val) => setForm((prev) => ({ ...prev, category: val }))}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Account Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Optional details or scope for this ledger account..."
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary text-xs py-2 px-5 font-bold rounded-xl bg-[#003164] hover:bg-[#00254c] text-white shadow-md shadow-blue-900/20"
            >
              {busy ? 'Saving...' : editItem ? 'Update Account' : 'Save Account'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Account"
        message="Are you sure you want to delete this custom account from the Chart of Accounts? Existing ledger entries linked to this code may be affected."
        confirmText="Delete Account"
      />

    </div>
  )
}
