import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Ticket, Download, Zap, Printer, Layers, BarChart3 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { api, apiError } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, date } from '../lib/format'
import { statusPill } from '../lib/format'
import { GlassCard, PageTitle, Pagination, Pill, Modal, EmptyState, CustomSelect, Spinner } from '../components/ui'
import { VoucherCard } from '../components/VoucherCard'
import VoucherGenerateTab from './VoucherGenerateTab'
import VoucherSalesSummaryTab from './VoucherSalesSummaryTab'

export default function Vouchers() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'vouchers' | 'batches' | 'generate' | 'sales-summary'>('generate')
  const [loadingAction, setLoadingAction] = useState(false)
  const [progress, setProgress] = useState(0)
  
  // Card Print Modal State
  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [printTitle, setPrintTitle] = useState('')
  const [printVouchers, setPrintVouchers] = useState<any[]>([])
  const [loadingPrint, setLoadingPrint] = useState(false)

  // Fetch voucher card template once for the page
  const { data: voucherTemplate } = useQuery<any>('voucher-template', () => api.get('/voucher-template').then((r) => r.data.data))

  const [resolvedTemplate, setResolvedTemplate] = useState<any>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)

  useEffect(() => {
    if (printVouchers.length > 0) {
      const first = printVouchers[0]
      const targetUserId = first.seller_id || first.reseller_id || first.owner_id
      if (targetUserId) {
        setLoadingTemplate(true)
        api.get('/voucher-template', { params: { user_id: targetUserId } })
          .then((r) => setResolvedTemplate(r.data.data))
          .catch(() => setResolvedTemplate(voucherTemplate))
          .finally(() => setLoadingTemplate(false))
      } else {
        setResolvedTemplate(voucherTemplate)
      }
    } else {
      setResolvedTemplate(voucherTemplate)
    }
  }, [printVouchers, voucherTemplate])

  const printSingleCard = (v: any) => {
    setPrintTitle(`Voucher Card: ${v.code}`)
    setPrintVouchers([v])
    setPrintModalOpen(true)
  }

  const printBatchCards = async (batchCode: string) => {
    setPrintTitle(`Voucher Cards: Batch ${batchCode}`)
    setPrintVouchers([])
    setLoadingPrint(true)
    setPrintModalOpen(true)
    try {
      const res = await api.get('/vouchers', { params: { batch: batchCode, per_page: 99999 } })
      setPrintVouchers(res.data.data.data || [])
    } catch (e) {
      alert(apiError(e))
      setPrintModalOpen(false)
    } finally {
      setLoadingPrint(false)
    }
  }

  // Vouchers state
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<any>({ status: '', code: '', batch: '' })
  // Applied filter signature — only changes on Apply, so typing doesn't refetch.
  const [appliedVoucherKey, setAppliedVoucherKey] = useState('{}')

  // Batches state
  const [batchesPage, setBatchesPage] = useState(1)
  const [batchFilters, setBatchFilters] = useState<any>({ plan_id: '', batch_code: '' })
  const [appliedBatchKey, setAppliedBatchKey] = useState('{}')

  // Sell state
  const [sellVoucher, setSellVoucher] = useState<any>(null)
  const [customerUsername, setCustomerUsername] = useState('')
  const [selling, setSelling] = useState(false)

  const cleanFilters = () => Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
  const cleanBatchFilters = () => Object.fromEntries(Object.entries(batchFilters).filter(([, v]) => v))

  const { data: plans = [], refetch: refetchPlans } = useQuery<any[]>('plans?active_only=1', () => api.get('/plans', { params: { active_only: 1 } }).then((r) => r.data.data))

  const { data, loading: vouchersLoading, refetch: load } = useQuery<any>(
    `vouchers?page=${page}&${appliedVoucherKey}`,
    () => api.get('/vouchers', { params: { page, ...cleanFilters() } }).then((r) => r.data.data),
  )

  const { data: batchesData, loading: batchesLoading, refetch: refetchBatches } = useQuery<any>(
    `batches?page=${batchesPage}&${appliedBatchKey}`,
    () => api.get('/batches', { params: { page: batchesPage, ...cleanBatchFilters() } }).then((r) => r.data.data),
    { enabled: activeTab === 'batches' },
  )

  const download = async (kind: 'export' | 'export-xlsx', extraParams?: any) => {
    const res = await api.get(`/vouchers/${kind}`, { params: { ...cleanFilters(), ...extraParams }, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = kind === 'export' ? 'vouchers.csv' : 'vouchers.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const openBlob = async (path: string, params?: any) => {
    setLoadingAction(true)
    setProgress(0)
    
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return 95
        const increment = Math.floor(Math.random() * 8) + 3
        return Math.min(95, prev + increment)
      })
    }, 150)

    try {
      const res = await api.get(path, { params, responseType: 'blob' })
      clearInterval(interval)
      setProgress(100)
      
      await new Promise((r) => setTimeout(r, 200))
      
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
    } catch (e) {
      clearInterval(interval)
      alert(apiError(e))
    } finally {
      setLoadingAction(false)
    }
  }

  const handleSell = async () => {
    if (!sellVoucher) return
    setSelling(true)
    try {
      await api.post(`/vouchers/${sellVoucher.id}/sell`, { customer_username: customerUsername })
      setSellVoucher(null)
      setCustomerUsername('')
      load()
      refresh()
    } catch (e) { alert(apiError(e)) } finally { setSelling(false) }
  }

  const toggleDisable = async (v: any) => {
    try {
      const endpoint = v.status === 'disabled' ? `/vouchers/${v.id}/enable` : `/vouchers/${v.id}/disable`
      await api.patch(endpoint)
      load()
    } catch (e) {
      alert(apiError(e))
    }
  }

  return (
    <div>
      <PageTitle 
        title="Voucher Sales" 
        subtitle="Generate & manage voucher cards"
        icon={<Ticket size={22} className="text-rose-500" />}
      />

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-slate-200 pb-2">
        <button 
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'generate' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          onClick={() => setActiveTab('generate')}
        >
          <Zap size={16} /> Generate Voucher
        </button>
        <button 
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'vouchers' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          onClick={() => setActiveTab('vouchers')}
        >
          <Ticket size={16} /> Vouchers List
        </button>
        <button
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'batches' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          onClick={() => setActiveTab('batches')}
        >
          <Layers size={16} /> Batches List
        </button>
        {user?.role !== 'seller' && (
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'sales-summary' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => setActiveTab('sales-summary')}
          >
            <BarChart3 size={16} /> Sales Summary
          </button>
        )}
      </div>

      {activeTab === 'vouchers' && (
        <>
          {/* Filters */}
          <GlassCard className="mb-4 flex flex-wrap gap-3 items-end relative z-10">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-500 mb-1">Status</label>
              <CustomSelect
                value={filters.status}
                onChange={(val) => setFilters({ ...filters, status: val })}
                options={[
                  { value: '', label: 'All Statuses' },
                  ...['active', 'used', 'sold', 'expired', 'disabled'].map((s) => ({ value: s, label: s.toUpperCase() }))
                ]}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Code</label>
              <input className="input mt-1" value={filters.code} onChange={(e) => setFilters({ ...filters, code: e.target.value })} placeholder="Search code" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Batch</label>
              <input className="input mt-1" value={filters.batch} onChange={(e) => setFilters({ ...filters, batch: e.target.value })} placeholder="Batch code" />
            </div>
            <button className="btn-primary" onClick={() => { setPage(1); setAppliedVoucherKey(JSON.stringify(cleanFilters())) }}>Apply</button>
          </GlassCard>

          <GlassCard className="!p-0 overflow-hidden">
            {vouchersLoading && !data ? <div className="py-8"><Spinner /></div> : null}
            <div className={`overflow-x-auto ${vouchersLoading && !data ? 'hidden' : ''}`}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Plan</th>
                    <th>Batch</th>
                    <th>Data</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.data || []).map((v: any, idx: number) => (
                    <motion.tr key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                      <td className="font-mono font-semibold">{v.code}</td>
                      <td>
                        <span>{v.plan?.name || '—'}</span>
                        {v.plan?.package_type && (
                          <Pill tone={v.plan.package_type === 'gb' ? 'success' : 'info'} className="ml-2">
                            {v.plan.package_type === 'gb' ? 'GB' : 'Wallet'}
                          </Pill>
                        )}
                      </td>
                      <td>
                        {v.batch?.batch_code ? (
                          <span className="inline-flex items-center gap-1 font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">
                            <Layers size={11} className="shrink-0 text-slate-400" />
                            {v.batch.batch_code}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{v.data_gb ? gb(v.data_gb) : '—'}</td>
                      <td>{rs(v.price)}</td>
                      <td><Pill tone={statusPill[v.status] || 'secondary'}>{v.status}</Pill></td>
                      <td className="text-xs">{date(v.expires_at)}</td>
                      <td className="text-right whitespace-nowrap">
                        {v.status === 'active' && (
                          <button className="text-xs font-bold text-emerald-600 hover:underline mr-3" onClick={() => { setSellVoucher(v); setCustomerUsername(''); setSelling(false) }}>Sell</button>
                        )}
                        <button 
                          className={`text-xs font-bold hover:underline mr-3 ${v.status === 'disabled' ? 'text-sky-600' : 'text-slate-500'}`} 
                          onClick={() => toggleDisable(v)}
                        >
                          {v.status === 'disabled' ? 'Enable' : 'Disable'}
                        </button>
                        <button className="text-xs font-bold text-primary hover:underline" onClick={() => printSingleCard(v)}>Card</button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {(data?.data || []).length === 0 && <EmptyState>No vouchers match.</EmptyState>}
            </div>
            <div className="p-4"><Pagination meta={data} onPage={setPage} /></div>
          </GlassCard>
        </>
      )}

      {activeTab === 'batches' && (
        <>
          {/* Batch Filters */}
          <GlassCard className="mb-4 flex flex-wrap gap-3 items-end relative z-10">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-500 mb-1">Plan</label>
              <CustomSelect
                value={batchFilters.plan_id ? +batchFilters.plan_id : ''}
                onChange={(val) => setBatchFilters({ ...batchFilters, plan_id: val })}
                options={[
                  { value: '', label: 'All Plans' },
                  ...plans
                    .filter((p) => (user?.role === 'admin' ? true : p.created_by === user?.id))
                    .map((p) => ({ value: p.id, label: p.name }))
                ]}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Batch Code</label>
              <input className="input mt-1" value={batchFilters.batch_code} onChange={(e) => setBatchFilters({ ...batchFilters, batch_code: e.target.value })} placeholder="Search batch" />
            </div>
            <button className="btn-primary" onClick={() => { setBatchesPage(1); setAppliedBatchKey(JSON.stringify(cleanBatchFilters())) }}>Apply</button>
          </GlassCard>

          <GlassCard className="!p-0 overflow-hidden">
            {batchesLoading && !batchesData ? <div className="py-8"><Spinner /></div> : null}
            <div className={`overflow-x-auto ${batchesLoading && !batchesData ? 'hidden' : ''}`}>
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Batch Code</th>
                    <th>Plan</th>
                    <th>Quantity</th>
                    <th>Generated By</th>
                    <th>Created At</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(batchesData?.data || []).map((b: any, idx: number) => (
                    <motion.tr key={b.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                      <td className="font-mono font-semibold">{b.batch_code}</td>
                      <td>
                        <span>{b.plan?.name || '—'}</span>
                        {b.plan?.package_type && (
                          <Pill tone={b.plan.package_type === 'gb' ? 'success' : 'info'} className="ml-2">
                            {b.plan.package_type === 'gb' ? 'GB' : 'Wallet'}
                          </Pill>
                        )}
                      </td>
                      <td>{b.quantity}</td>
                      <td>{b.generated_by?.username || '—'}</td>
                      <td className="text-xs">{date(b.created_at)}</td>
                      <td className="text-right whitespace-nowrap">
                        <button className="text-xs font-bold text-emerald-600 hover:underline mr-3 flex items-center inline-flex gap-1" onClick={() => printBatchCards(b.batch_code)}><Printer size={13} /> Print Cards</button>
                        <button className="text-xs font-bold text-primary hover:underline mr-3 flex items-center inline-flex gap-1" onClick={() => download('export', { batch: b.batch_code })}><Download size={13} /> CSV</button>
                        <button className="text-xs font-bold text-primary hover:underline flex items-center inline-flex gap-1" onClick={() => download('export-xlsx', { batch: b.batch_code })}><Download size={13} /> Excel</button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {(batchesData?.data || []).length === 0 && <EmptyState>No batches found.</EmptyState>}
            </div>
            <div className="p-4"><Pagination meta={batchesData} onPage={setBatchesPage} /></div>
          </GlassCard>
        </>
      )}

      {activeTab === 'generate' && (
        <VoucherGenerateTab
          plans={plans}
          refetchPlans={refetchPlans}
          onSuccess={() => {
            load()
            refetchBatches()
          }}
        />
      )}

      {activeTab === 'sales-summary' && <VoucherSalesSummaryTab />}

      {/* Sell Voucher Modal */}
      <Modal open={!!sellVoucher} onClose={() => setSellVoucher(null)} title={`Sell Voucher: ${sellVoucher?.code}`}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-500">Customer Username (Optional)</label>
            <input 
              className="input mt-1" 
              placeholder="e.g. hotel_room_101" 
              value={customerUsername} 
              onChange={(e) => setCustomerUsername(e.target.value)} 
            />
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Plan</span><span className="font-bold">{sellVoucher?.plan?.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Price</span><span className="font-bold">{rs(sellVoucher?.price)}</span></div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setSellVoucher(null)}>Cancel</button>
            <motion.button 
              whileTap={{ scale: 0.95 }} 
              className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md" 
              disabled={selling} 
              onClick={handleSell}
            >
              {selling ? 'Selling…' : 'Mark as Sold'}
            </motion.button>
          </div>
        </div>
      </Modal>

      {/* Progress Bar Overlay */}
      {loadingAction && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/45 backdrop-blur-sm select-none">
          <div className="bg-white p-6 rounded-[24px] shadow-2xl flex flex-col items-center gap-4 border border-slate-100 max-w-xs text-center w-80">
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
              <div 
                className="absolute top-0 left-0 h-full bg-[#003164] rounded-full transition-all duration-150 ease-out" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className="mt-1">
              <p className="text-sm font-extrabold text-slate-800">Generating Card Document ({progress}%)</p>
              <p className="text-xs text-slate-400 font-semibold mt-1">Please wait a moment while we render your cards.</p>
            </div>
          </div>
        </div>
      )}

      {/* Print Voucher Cards Modal */}
      <Modal 
        open={printModalOpen} 
        onClose={() => setPrintModalOpen(false)} 
        title={printTitle}
        widthClassName="max-w-4xl"
      >
        <div className="print-modal-content">
          <div className="noprint flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
            <div>
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Voucher Cards</p>
              <p className="text-sm font-extrabold text-[#003164]">
                {loadingPrint ? 'Loading vouchers...' : `${printVouchers.length} card(s) ready`}
              </p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => window.print()} 
                disabled={!resolvedTemplate || loadingTemplate || loadingPrint || printVouchers.length === 0} 
                className="btn-primary py-2.5 px-6 rounded-2xl font-bold flex items-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer size={16} /> Print Cards
              </button>
            </div>
          </div>

          {loadingPrint ? (
            <Spinner />
          ) : (!resolvedTemplate || loadingTemplate) ? (
            <div className="py-12 text-center text-slate-500">Loading card template...</div>
          ) : printVouchers.length === 0 ? (
            <div className="py-12 text-center text-slate-500">No cards to display.</div>
          ) : (
            <div className="print-cards-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 justify-items-center max-h-[60vh] overflow-y-auto p-4 bg-slate-50/50 rounded-3xl border border-slate-200/50">
              {printVouchers.map((v) => (
                <div key={v.id} className="print-card-wrapper">
                  <VoucherCard
                    code={v.code}
                    planName={v.plan?.name}
                    price={v.price}
                    username={v.username}
                    password={v.password}
                    template={resolvedTemplate}
                    size={220}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Portal for clean, style-isolated high-res print output */}
      {printModalOpen && !loadingPrint && resolvedTemplate && !loadingTemplate && printVouchers.length > 0 && createPortal(
        <div className="print-area">
          <div className="print-cards-grid">
            {printVouchers.map((v) => (
              <div key={v.id} className="print-card-wrapper">
                <VoucherCard
                  code={v.code}
                  planName={v.plan?.name}
                  price={v.price}
                  username={v.username}
                  password={v.password}
                  template={resolvedTemplate}
                  size={265}
                />
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
