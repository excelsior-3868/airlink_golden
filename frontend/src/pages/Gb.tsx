import { useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { gb, datet } from '../lib/format'
import { GlassCard, PageTitle, Pagination, Pill, StatCard, EmptyState } from '../components/ui'
import { Database, PlusCircle } from 'lucide-react'
import FundModal from '../components/FundModal'

const tone: Record<string, string> = { allocate: 'success', deduct: 'danger', refund: 'info', opening: 'secondary' }

export default function Gb() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [fundOpen, setFundOpen] = useState(false)

  const { data, refetch } = useQuery(
    `gb/transactions?page=${page}`,
    () => api.get('/gb/transactions', { params: { page } }).then((r) => r.data.data),
  )

  return (
    <div>
      <PageTitle 
        title="GB Allocation" 
        subtitle="Data quota balance & transactions" 
        icon={<Database size={22} className="text-cyan-500" />} 
        action={
          (user?.role === 'admin' || user?.role === 'reseller') && (
            <button
              onClick={() => setFundOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PlusCircle size={16} /> Allocate GB
            </button>
          )
        }
      />
      <div className="max-w-xs mb-6">
        <StatCard label="Current GB Balance" value={gb(user!.gb_balance)} icon={<Database size={22} />} />
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th>Date</th><th>Account</th><th>Type</th><th>GB</th><th>Balance After</th><th>Note</th></tr></thead>
            <tbody>
              {(data?.data || []).map((t: any, idx: number) => (
                <motion.tr key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                  <td className="whitespace-nowrap text-xs">{datet(t.created_at)}</td>
                  <td className="font-mono text-xs">{t.user?.username}</td>
                  <td><Pill tone={tone[t.type] || 'secondary'}>{t.type}</Pill></td>
                  <td className="font-semibold">{gb(t.gb_amount)}</td>
                  <td>{gb(t.balance_after)}</td>
                  <td className="text-xs text-muted-foreground">{t.note || t.reference || '—'}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          {(data?.data || []).length === 0 && <EmptyState>No transactions yet.</EmptyState>}
        </div>
        <div className="p-4"><Pagination meta={data} onPage={setPage} /></div>
      </GlassCard>
      <p className="text-xs text-muted-foreground mt-3">Allocate GB to your downline from the Resellers / Sellers page.</p>

      <FundModal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        onSuccess={() => { refetch(); invalidateCache('dashboard') }}
        defaultAllocType="gb"
      />
    </div>
  )
}
