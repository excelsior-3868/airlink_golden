import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, datet } from '../lib/format'
import { GlassCard, PageTitle, Pagination, Pill, StatCard, EmptyState, Spinner } from '../components/ui'
import { Wallet as WalletIcon, Database, PlusCircle } from 'lucide-react'
import FundModal from '../components/FundModal'

const tone: Record<string, string> = { 
  load: 'success', 
  allocate: 'success', 
  transfer: 'warning', 
  deduct: 'danger', 
  refund: 'info', 
  opening: 'secondary' 
}

type TabType = 'wallet' | 'gb'

export default function FundAllocation({ defaultTab }: { defaultTab?: TabType }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Determine initial active tab based on props, query params, or user role
  const getInitialTab = (): TabType => {
    const params = new URLSearchParams(location.search)
    const tabParam = params.get('tab') as TabType
    if (tabParam === 'wallet' || tabParam === 'gb') return tabParam
    if (defaultTab) return defaultTab
    return user?.role === 'admin' ? 'wallet' : 'gb'
  }

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [walletPage, setWalletPage] = useState(1)
  const [gbPage, setGbPage] = useState(1)
  const [fundOpen, setFundOpen] = useState(false)

  // Sync state with URL query param if tab changes
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    navigate(`${location.pathname}?tab=${tab}`, { replace: true })
  }

  // Fetch Wallet Transactions
  const { data: walletData, loading: walletLoading, refetch: refetchWallet } = useQuery(
    `wallet/transactions?page=${walletPage}`,
    () => api.get('/wallet/transactions', { params: { page: walletPage } }).then((r) => r.data.data),
    { enabled: activeTab === 'wallet' && user?.role === 'admin' }
  )

  // Fetch GB Transactions
  const { data: gbData, loading: gbLoading, refetch: refetchGb } = useQuery(
    `gb/transactions?page=${gbPage}`,
    () => api.get('/gb/transactions', { params: { page: gbPage } }).then((r) => r.data.data),
    { enabled: activeTab === 'gb' }
  )

  const handleRefresh = () => {
    if (activeTab === 'wallet') refetchWallet()
    if (activeTab === 'gb') refetchGb()
    invalidateCache('dashboard')
  }

  return (
    <div className="space-y-6">
      <PageTitle 
        title="Wallet & GB Allocation" 
        subtitle="Manage downline cash wallet loads and data quota allocations" 
        icon={<WalletIcon size={22} className="text-emerald-500" />} 
      />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {user?.role === 'admin' && (
          <GlassCard className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400">Wallet Balance</p>
              <p className="text-xl font-extrabold text-emerald-600 mt-1">{rs(user?.wallet_balance || 0)}</p>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <WalletIcon size={20} />
            </div>
          </GlassCard>
        )}
        <GlassCard className="p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-400 font-sans">Current GB Quota</p>
            <p className="text-xl font-extrabold text-cyan-600 mt-1">{gb(user?.gb_balance || 0)}</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center font-bold">
            <Database size={20} />
          </div>
        </GlassCard>
      </div>

      {/* Tab Navigation (Segmented Pill Bar) */}
      <div className="inline-flex items-center gap-1.5 p-1.5 bg-slate-100/90 border border-slate-200/70 rounded-2xl shadow-inner select-none">
        {user?.role === 'admin' && (
          <button
            type="button"
            onClick={() => handleTabChange('wallet')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'wallet'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
            }`}
          >
            <WalletIcon size={16} className={activeTab === 'wallet' ? 'text-emerald-600' : 'text-slate-400'} />
            <span>Wallet Allocation</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => handleTabChange('gb')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
            activeTab === 'gb'
              ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80'
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
          }`}
        >
          <Database size={16} className={activeTab === 'gb' ? 'text-cyan-600' : 'text-slate-400'} />
          <span>GB Allocation</span>
        </button>
      </div>

      {/* Tab Contents */}
      <AnimatePresence mode="wait">
        {activeTab === 'wallet' && user?.role === 'admin' && (
          <motion.div
            key="wallet"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <GlassCard className="!p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-bold text-sm text-slate-800">Wallet Fund Audit Log</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Itemized record of cash wallet transfers and loads</p>
                </div>
                {(user?.role === 'admin' || user?.role === 'reseller') && (
                  <button
                    onClick={() => setFundOpen(true)}
                    className="btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5 rounded-xl font-bold shadow-md shadow-emerald-600/20 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <PlusCircle size={15} /> Allocate Wallet
                  </button>
                )}
              </div>
              {walletLoading && !walletData?.data ? <Spinner /> : null}
              <div className={`overflow-x-auto ${walletLoading && !walletData?.data ? 'hidden' : ''}`}>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/30">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Account</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Balance After</th>
                      <th className="py-3 px-4">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {(walletData?.data || []).map((t: any, idx: number) => (
                      <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-500">{datet(t.created_at)}</td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-700">{t.user?.username || '—'}</td>
                        <td className="py-3 px-4"><Pill tone={tone[t.type] || 'secondary'}>{t.type}</Pill></td>
                        <td className="py-3 px-4 font-extrabold text-slate-800">{rs(t.amount)}</td>
                        <td className="py-3 px-4 font-semibold text-slate-600">{rs(t.balance_after)}</td>
                        <td className="py-3 px-4 text-slate-400">{t.note || t.reference || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(walletData?.data || []).length === 0 && <EmptyState>No wallet transactions recorded yet.</EmptyState>}
              </div>
              <div className="p-4 border-t border-slate-100">
                <Pagination meta={walletData} onPage={setWalletPage} />
              </div>
            </GlassCard>
          </motion.div>
        )}

        {activeTab === 'gb' && (
          <motion.div
            key="gb"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <GlassCard className="!p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-bold text-sm text-slate-800">GB Allocation Audit Log</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Itemized record of data quota transfers and allocations</p>
                </div>
                {(user?.role === 'admin' || user?.role === 'reseller') && (
                  <button
                    onClick={() => setFundOpen(true)}
                    className="btn-primary text-xs py-2 px-3.5 flex items-center gap-1.5 rounded-xl font-bold shadow-md shadow-cyan-600/20 bg-cyan-600 hover:bg-cyan-700 text-white"
                  >
                    <PlusCircle size={15} /> Allocate GB
                  </button>
                )}
              </div>

              {gbLoading && !gbData?.data ? <Spinner /> : null}
              <div className={`overflow-x-auto ${gbLoading && !gbData?.data ? 'hidden' : ''}`}>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/30">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Account</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">GB Quota</th>
                      <th className="py-3 px-4">Balance After</th>
                      <th className="py-3 px-4">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {(gbData?.data || []).map((t: any, idx: number) => (
                      <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap text-slate-500">{datet(t.created_at)}</td>
                        <td className="py-3 px-4 font-mono font-semibold text-slate-700">{t.user?.username || '—'}</td>
                        <td className="py-3 px-4"><Pill tone={tone[t.type] || 'secondary'}>{t.type}</Pill></td>
                        <td className="py-3 px-4 font-extrabold text-cyan-700">{gb(t.gb_amount)}</td>
                        <td className="py-3 px-4 font-semibold text-slate-600">{gb(t.balance_after)}</td>
                        <td className="py-3 px-4 text-slate-400">{t.note || t.reference || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(gbData?.data || []).length === 0 && <EmptyState>No GB allocation transactions recorded yet.</EmptyState>}
              </div>
              <div className="p-4 border-t border-slate-100">
                <Pagination meta={gbData} onPage={setGbPage} />
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      <FundModal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        onSuccess={() => handleRefresh()}
        defaultAllocType={activeTab}
      />
    </div>
  )
}
