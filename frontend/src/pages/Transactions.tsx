import { useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, gb, datet } from '../lib/format'
import { useBranding } from '../lib/branding'
import { GlassCard, PageTitle, Pagination, Pill, EmptyState, Spinner } from '../components/ui'
import { ArrowLeftRight, Wallet, Database, FileText, HandCoins } from 'lucide-react'

type Source = '' | 'wallet' | 'gb' | 'invoice' | 'payment'

const FILTERS: { key: Source; label: string; icon: any }[] = [
  { key: '', label: 'All', icon: ArrowLeftRight },
  { key: 'gb', label: 'GB', icon: Database },
  { key: 'invoice', label: 'Invoices', icon: FileText },
  { key: 'payment', label: 'Payments', icon: HandCoins },
]

// Colour + label per transaction type.
const typeTone = (t: any): string => {
  switch (t.source) {
    case 'wallet':
      return t.type === 'deduct' ? 'danger' : t.type === 'refund' ? 'info' : 'success'
    case 'gb':
      return t.type === 'deduct' ? 'danger' : t.type === 'refund' ? 'info' : 'success'
    case 'invoice':
      return t.status === 'paid' ? 'success' : 'warning'
    case 'payment':
      return 'info'
    default:
      return 'secondary'
  }
}

const typeLabel = (t: any): string => {
  if (t.source === 'invoice') return `Invoice · ${t.type}`
  if (t.source === 'payment') return 'Payment'
  if (t.source === 'gb') return `GB ${t.type}`
  return t.type
}

const amountText = (t: any) => (t.unit === 'gb' ? gb(t.amount) : rs(t.amount))

export default function Transactions() {
  const { user } = useAuth()
  const pppoeOnly = useBranding().branding.pppoe_only
  const [page, setPage] = useState(1)
  const [source, setSource] = useState<Source>('')

  const { data, loading } = useQuery(
    `transactions?page=${page}&source=${source}`,
    () => api.get('/transactions', { params: { page, source: source || undefined } }).then((r) => r.data.data),
  )

  const subtitle = user?.role === 'admin'
    ? 'Complete ledger across all accounts'
    : 'Your wallet, GB, invoice & payment history'

  return (
    <div>
      <PageTitle title="Transactions" subtitle={subtitle} icon={<ArrowLeftRight size={22} className="text-blue-500" />} />

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.filter((f) => !(pppoeOnly && f.key === 'gb')).map((f) => {
          const active = source === f.key
          return (
            <button
              key={f.key || 'all'}
              onClick={() => { setSource(f.key); setPage(1) }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl text-xs font-bold border transition-all ${
                active
                  ? 'bg-primary text-white border-primary shadow-md shadow-primary/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <f.icon size={14} /> {f.label}
            </button>
          )
        })}
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        {loading && !data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance After</th>
                  <th>Counterparty</th>
                  <th>Reference / Note</th>
                </tr>
              </thead>
              <tbody>
                {(data?.data || []).filter((t: any) => !(pppoeOnly && t.source === 'gb')).map((t: any, idx: number) => (
                  <motion.tr key={t.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                    <td className="whitespace-nowrap text-xs">{datet(t.created_at)}</td>
                    <td className="font-mono text-xs">{t.account || '—'}</td>
                    <td><Pill tone={typeTone(t)}>{typeLabel(t)}</Pill></td>
                    <td className="font-semibold whitespace-nowrap">{amountText(t)}</td>
                    <td className="whitespace-nowrap">{t.balance_after !== null ? (t.unit === 'gb' ? gb(t.balance_after) : rs(t.balance_after)) : '—'}</td>
                    <td className="font-mono text-xs">{t.from && t.to ? `${t.from} → ${t.to}` : (t.from || t.to || '—')}</td>
                    <td className="text-xs text-muted-foreground">{t.reference || t.note || '—'}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {(data?.data || []).length === 0 && <EmptyState>No transactions found.</EmptyState>}
          </div>
        )}
        <div className="p-4"><Pagination meta={data} onPage={setPage} /></div>
      </GlassCard>
    </div>
  )
}
