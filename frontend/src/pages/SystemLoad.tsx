import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Wallet, Database, PlusCircle, AlertCircle, FileText, History, Search, User as UserIcon, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageTitle, GlassCard, CustomSelect } from '../components/ui'
import { rs, gb, datet } from '../lib/format'

interface SystemLoadRecord {
  id: number
  user_id: number
  created_by: number
  wallet_amount: number | string
  gb_amount: number | string
  wallet_balance_after: number | string
  gb_balance_after: number | string
  note: string | null
  created_at: string
  creator?: {
    id: number
    name: string
    username: string
    role: string
  }
  user?: {
    id: number
    name: string
    username: string
    role: string
  }
}

export default function SystemLoad() {
  const { refresh } = useAuth()
  const [walletAmount, setWalletAmount] = useState('')
  const [gbAmount, setGbAmount] = useState('')
  const [note, setNote] = useState('')
  
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState('')

  // History state
  const [history, setHistory] = useState<SystemLoadRecord[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [total, setTotal] = useState(0)
  const [lastPage, setLastPage] = useState(1)

  const fetchHistory = useCallback(async (targetPage = page, targetPerPage = perPage, targetSearch = search) => {
    setLoadingHistory(true)
    try {
      const res = await api.get('/admin/system-loads', {
        params: {
          page: targetPage,
          per_page: targetPerPage,
          search: targetSearch || undefined,
        },
      })
      const payload = res.data?.data || res.data || {}
      const items = Array.isArray(payload) ? payload : (payload.data || [])
      setHistory(Array.isArray(items) ? items : [])
      setTotal(payload.total ?? (Array.isArray(items) ? items.length : 0))
      setLastPage(payload.last_page ?? 1)
      setPage(payload.current_page ?? targetPage)
    } catch (e: any) {
      console.error('Failed to fetch system load history:', e)
    } finally {
      setLoadingHistory(false)
    }
  }, [page, perPage, search])

  useEffect(() => {
    fetchHistory(page, perPage, search)
  }, [page, perPage, search, fetchHistory])

  const handleSystemLoad = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setSuccess('')
    setBusy(true)

    try {
      const payload: any = {}
      if (walletAmount) payload.wallet_amount = parseFloat(walletAmount)
      if (gbAmount) payload.gb_amount = parseFloat(gbAmount)
      if (note) payload.note = note

      await api.post('/admin/system-load', payload)
      setSuccess('System load processed successfully. Your balance has been updated.')
      setWalletAmount('')
      setGbAmount('')
      setNote('')
      
      // Refresh the context user balance shown in top-bar & reload history list
      refresh()
      fetchHistory(1, perPage, search)
    } catch (e: any) {
      setErr(e.response?.data?.message || 'Failed to process system load.')
    } finally {
      setBusy(false)
    }
  }

  const perPageOptions = [
    { value: 10, label: '10 Per Page' },
    { value: 20, label: '20 Per Page' },
    { value: 50, label: '50 Per Page' },
    { value: 100, label: '100 Per Page' },
  ]

  return (
    <div className="space-y-6">
      <PageTitle
        title="System Load"
        subtitle="Load additional master credits directly into the root Admin account"
        icon={<PlusCircle size={22} className="text-emerald-500" />}
      />

      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2.5 border-b border-slate-100/60">
          <div>
            <h2 className="text-base font-bold text-[#003164] flex items-center gap-2">
              <AlertCircle size={18} className="text-amber-500 shrink-0" />
              Master Vault Load
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Load balance or data quota directly into your root Admin account pool.
            </p>
          </div>
        </div>

        <form onSubmit={handleSystemLoad} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Wallet size={13} className="text-emerald-500" />
                  Wallet Load (Rs.)
                </label>
                {walletAmount && !isNaN(Number(walletAmount)) && Number(walletAmount) > 0 && (
                  <span className="text-[10px] font-extrabold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100/80">
                    {rs(walletAmount)}
                  </span>
                )}
              </div>
              <input
                className="input py-2 text-xs"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 500000"
                value={walletAmount}
                onChange={(e) => setWalletAmount(e.target.value)}
              />
            </div>

            <div className="md:col-span-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Database size={13} className="text-purple-500" />
                  GB Load (Quota)
                </label>
                {gbAmount && !isNaN(Number(gbAmount)) && Number(gbAmount) > 0 && (
                  <span className="text-[10px] font-extrabold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100/80">
                    {gb(gbAmount)}
                  </span>
                )}
              </div>
              <input
                className="input py-2 text-xs"
                type="number"
                min="0"
                step="0.001"
                placeholder="e.g. 10000"
                value={gbAmount}
                onChange={(e) => setGbAmount(e.target.value)}
              />
            </div>

            <div className="md:col-span-4">
              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1 flex items-center gap-1.5">
                <FileText size={13} className="text-slate-400" />
                Note / Reference
              </label>
              <input
                className="input py-2 text-xs"
                placeholder="e.g. Initial master allocation"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="md:col-span-2">
              <motion.button
                whileTap={{ scale: 0.96 }}
                disabled={busy || (!walletAmount && !gbAmount)}
                type="submit"
                className="btn-primary py-2 px-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <PlusCircle size={15} />
                {busy ? 'Loading...' : 'Submit Load'}
              </motion.button>
            </div>
          </div>

          {err && <div className="pill danger w-full justify-center py-2 text-xs font-semibold">{err}</div>}
          {success && <div className="pill success w-full justify-center py-2 text-xs font-semibold">{success}</div>}
        </form>
      </GlassCard>

      {/* System Load History Section */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/40">
          <div>
            <h2 className="text-lg font-bold text-[#003164] flex items-center gap-2">
              <History size={20} className="text-emerald-500" />
              System Load History
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Historical ledger of all master credit additions, quota top-ups, and performer details
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Search filter input */}
            <div className="relative flex-1 sm:w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                className="input py-2 pl-9 text-xs"
                placeholder="Search Notes Or Admin..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
              />
            </div>

            {/* Custom Select dropdown for Per Page per Rule 2 */}
            <div className="w-36">
              <CustomSelect
                options={perPageOptions}
                value={perPage}
                onChange={(val) => {
                  setPerPage(Number(val))
                  setPage(1)
                }}
                searchable={false}
              />
            </div>

            <button
              onClick={() => fetchHistory(page, perPage, search)}
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-white transition"
              title="Refresh History"
            >
              <RefreshCw size={16} className={loadingHistory ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* History Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-100/50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Loaded By</th>
                <th className="py-3 px-4">Target Account</th>
                <th className="py-3 px-4 text-right">Wallet Load (Rs.)</th>
                <th className="py-3 px-4 text-right">GB Load (Quota)</th>
                <th className="py-3 px-4">Balances After</th>
                <th className="py-3 px-4">Note / Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {loadingHistory ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-28"></div></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-20 ml-auto"></div></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-32"></div></td>
                    <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded w-36"></div></td>
                  </tr>
                ))
              ) : !Array.isArray(history) || history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <History size={32} className="text-slate-300 stroke-1" />
                      <p className="text-sm font-semibold text-slate-500">No System Load History Found</p>
                      <p className="text-xs text-slate-400">New system loads will be recorded and displayed here.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                (Array.isArray(history) ? history : []).map((record) => {
                  const walletVal = Number(record.wallet_amount)
                  const gbVal = Number(record.gb_amount)

                  return (
                    <tr key={record.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-medium text-slate-600 whitespace-nowrap">
                        {datet(record.created_at)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="p-1 rounded-lg bg-emerald-50 text-emerald-600">
                            <UserIcon size={13} />
                          </span>
                          <span className="font-semibold text-slate-800">
                            {record.creator?.name || record.creator?.username || `User #${record.created_by}`}
                          </span>
                          {record.creator?.username && (
                            <span className="text-[10px] text-slate-400">({record.creator.username})</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="p-1 rounded-lg bg-slate-100 text-slate-500">
                            <UserIcon size={13} />
                          </span>
                          <span className="font-medium text-slate-700">
                            {record.user?.name || record.user?.username || `User #${record.user_id}`}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold text-emerald-600">
                        {walletVal > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100/60">
                            + {rs(walletVal)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold text-purple-600">
                        {gbVal > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100/60">
                            + {gb(gbVal)}
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                        <div className="flex flex-col text-[11px]">
                          <span><strong className="text-slate-700">Wallet:</strong> {rs(record.wallet_balance_after)}</span>
                          <span><strong className="text-slate-700">GB:</strong> {gb(record.gb_balance_after)}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        {record.note ? (
                          <span className="inline-block max-w-xs truncate bg-slate-100/80 px-2 py-1 rounded text-slate-700" title={record.note}>
                            {record.note}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">No note provided</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {total > 0 && (
          <div className="p-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/40">
            <p className="text-xs text-slate-500">
              Showing <strong className="text-slate-700">{(page - 1) * perPage + 1}</strong> to{' '}
              <strong className="text-slate-700">{Math.min(page * perPage, total)}</strong> of{' '}
              <strong className="text-slate-700">{total}</strong> Entries
            </p>

            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Previous Page"
              >
                <ChevronLeft size={16} />
              </button>

              <span className="px-3 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg">
                Page {page} of {lastPage}
              </span>

              <button
                disabled={page >= lastPage}
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Next Page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
