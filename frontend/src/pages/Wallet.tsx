import { useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, datet } from '../lib/format'
import { GlassCard, PageTitle, Pagination, Pill, StatCard, EmptyState } from '../components/ui'
import { Wallet as WalletIcon, PlusCircle } from 'lucide-react'
import FundModal from '../components/FundModal'

const tone: Record<string, string> = { load: 'success', transfer: 'warning', deduct: 'danger', refund: 'info', opening: 'secondary' }

export default function Wallet() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [fundOpen, setFundOpen] = useState(false)

  const { data, refetch } = useQuery(
    `wallet/transactions?page=${page}`,
    () => api.get('/wallet/transactions', { params: { page } }).then((r) => r.data.data),
  )

  return (
    <div>
      <PageTitle 
        title="Wallet" 
        subtitle="Money balance & transactions" 
        icon={<WalletIcon size={22} className="text-emerald-500" />} 
        action={
          (user?.role === 'admin' || user?.role === 'reseller') && (
            <button
              onClick={() => setFundOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PlusCircle size={16} /> Allocate Wallet
            </button>
          )
        }
      />
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <StatCard label="Current Balance" value={rs(user!.wallet_balance)} icon={<WalletIcon size={22} />} />
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Amount</th><th>Balance After</th><th>Note</th></tr></thead>
            <tbody>
              {(data?.data || []).map((t: any, idx: number) => (
                <motion.tr key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                  <td className="whitespace-nowrap text-xs">{datet(t.created_at)}</td>
                  <td className="font-mono text-xs">{t.user?.username}</td>
                  <td><Pill tone={tone[t.type] || 'secondary'}>{t.type}</Pill></td>
                  <td className="font-semibold">{rs(t.amount)}</td>
                  <td>{rs(t.balance_after)}</td>
                  <td className="text-xs text-muted-foreground">{t.note || t.reference || '—'}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          {(data?.data || []).length === 0 && <EmptyState>No transactions yet.</EmptyState>}
        </div>
        <div className="p-4"><Pagination meta={data} onPage={setPage} /></div>
      </GlassCard>
      <p className="text-xs text-muted-foreground mt-3">Load funds to your downline from the Resellers / Sellers page.</p>

      <FundModal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        onSuccess={() => { refetch(); invalidateCache('dashboard') }}
        defaultAllocType="wallet"
      />
    </div>
  )
}
