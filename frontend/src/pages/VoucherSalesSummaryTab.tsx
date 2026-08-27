import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Ticket, CreditCard, Archive, Database, TrendingUp, Users, UserRound } from 'lucide-react'
import { api } from '../lib/api'
import { useQuery } from '../lib/cache'
import { rs, gb, num } from '../lib/format'
import { GlassCard, EmptyState, Spinner, StatCard, Combobox, SelectOption } from '../components/ui'

export default function VoucherSalesSummaryTab() {
  const [selected, setSelected] = useState<any>(null)

  return selected ? (
    <ResellerDetail account={selected} onBack={() => setSelected(null)} />
  ) : (
    <AccountList onSelect={setSelected} />
  )
}

/** Which tier a row belongs to. Both tiers share one table, so every row says so. */
function RoleTag({ role }: { role: string }) {
  const isSeller = role === 'seller'
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
        isSeller
          ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
          : 'bg-indigo-50 text-indigo-600 border-indigo-100'
      }`}
    >
      {isSeller ? <UserRound size={10} /> : <Users size={10} />}
      {isSeller ? 'Seller' : 'Reseller'}
    </span>
  )
}

// A reseller and a seller can hold the same id, so an account is addressed by
// the pair. '' means no account selected — show every row.
const accountKey = (a: any) => `${a.role}:${a.id}`

function AccountList({ onSelect }: { onSelect: (account: any) => void }) {
  // One request covers both tiers; the endpoint returns every account the actor
  // may see in a single unpaginated payload, so filtering is client-side.
  const { data, loading } = useQuery<any>('reports/reseller-summary?group=all', () =>
    api.get('/reports/reseller-summary', { params: { group: 'all' } }).then((r) => r.data.data),
  )

  const [account, setAccount] = useState<string>('')

  const accounts: any[] = data?.accounts || []
  const visible = account ? accounts.filter((a) => accountKey(a) === account) : accounts

  const options: SelectOption[] = [
    { value: '', label: 'All Accounts' },
    ...accounts.map((a) => ({
      value: accountKey(a),
      label: a.name,
      // The label is the account name, so username would otherwise be
      // unsearchable — it is the thing operators actually remember.
      keywords: a.username,
      group: a.role === 'seller' ? 'Sellers' : 'Resellers',
      badge: <RoleTag role={a.role} />,
    })),
  ]

  // Totals follow what is on screen rather than the payload's own totals, so a
  // selected account's figures are not read against a system-wide sum.
  const totals = {
    cards_generated: visible.reduce((n, a) => n + (a.cards_generated || 0), 0),
    cards_sold: visible.reduce((n, a) => n + (a.cards_sold || 0), 0),
    gb_sold: visible.reduce((n, a) => n + (a.gb_sold || 0), 0),
    sales_amount: visible.reduce((n, a) => n + (a.sales_amount || 0), 0),
  }

  return (
    <GlassCard className="!p-0 overflow-hidden">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-extrabold text-slate-800 text-sm">Account Summary</h3>
          <p className="text-xs text-slate-400">
            Card generation and sales totals per account. A reseller row counts the cards it holds
            itself; cards handed to a seller are counted on that seller's row.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <Spinner />}
          <Combobox
            value={account}
            onChange={(val) => setAccount(val)}
            options={options}
            placeholder="All Accounts"
            className="w-full sm:w-72"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th>Account</th>
              <th>Cards Generated</th>
              <th>Cards Sold</th>
              <th>Cards in Stock</th>
              <th>GB Sold</th>
              <th>Sales Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a: any, idx: number) => (
              <motion.tr
                key={accountKey(a)}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.02 }}
                className="hover:bg-secondary/30 cursor-pointer"
                onClick={() => onSelect(a)}
              >
                <td className="font-semibold text-slate-800">
                  <div className="flex items-center gap-2">
                    <span>{a.name}</span>
                    <RoleTag role={a.role} />
                  </div>
                  <div className="text-xs font-mono text-slate-400">{a.username}</div>
                </td>
                <td>{num(a.cards_generated)}</td>
                <td>{num(a.cards_sold)}</td>
                <td>{num(a.cards_in_stock)}</td>
                <td>{gb(a.gb_sold)}</td>
                <td className="font-bold text-blue-600">{rs(a.sales_amount)}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
        {!loading && visible.length === 0 && (
          <EmptyState>{account ? 'That account has no rows.' : 'No reseller or seller accounts found.'}</EmptyState>
        )}
      </div>

      {visible.length > 0 && (
        <div className="p-4 border-t border-slate-100 flex flex-wrap gap-x-8 gap-y-1 text-xs">
          <span className="font-bold text-slate-500">Totals:</span>
          <span>Generated <b className="text-slate-700">{num(totals.cards_generated)}</b></span>
          <span>Sold <b className="text-slate-700">{num(totals.cards_sold)}</b></span>
          <span>GB Sold <b className="text-slate-700">{gb(totals.gb_sold)}</b></span>
          <span>Sales <b className="text-blue-600">{rs(totals.sales_amount)}</b></span>
        </div>
      )}
    </GlassCard>
  )
}

function ResellerDetail({ account, onBack }: { account: any; onBack: () => void }) {
  const groupParam = account.role === 'seller' ? 'seller_id' : 'reseller_id'
  const { data, loading } = useQuery<any>(`reports/package-summary?${groupParam}=${account.id}`, () =>
    api.get('/reports/package-summary', { params: { [groupParam]: account.id } }).then((r) => r.data.data),
  )

  const packages = data?.packages || []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 shrink-0"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{account.role === 'seller' ? 'Seller' : 'Reseller'}</p>
          <h3 className="font-extrabold text-slate-800 text-base">{account.name}</h3>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Cards Generated" value={num(account.cards_generated)} icon={<Ticket size={18} />} iconColorClass="text-indigo-600 bg-indigo-50" />
        <StatCard label="Cards Sold" value={num(account.cards_sold)} icon={<CreditCard size={18} />} iconColorClass="text-amber-600 bg-amber-50" />
        <StatCard label="Cards in Stock" value={num(account.cards_in_stock)} icon={<Archive size={18} />} iconColorClass="text-slate-600 bg-slate-100" />
        <StatCard label="GB Sold" value={gb(account.gb_sold)} icon={<Database size={18} />} iconColorClass="text-sky-600 bg-sky-50" />
        <StatCard label="Total Sales" value={rs(account.sales_amount)} icon={<TrendingUp size={18} />} iconColorClass="text-blue-600 bg-blue-50" />
      </div>

      <GlassCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-extrabold text-slate-800 text-sm">Package-wise Sales</h3>
          <p className="text-xs text-slate-400">Breakdown of cards generated and sold per package</p>
        </div>
        <div className="overflow-x-auto">
          {loading && !data ? (
            <div className="py-8"><Spinner /></div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Generated</th>
                  <th>Sold</th>
                  <th>Remaining</th>
                  <th>GB Sold</th>
                  <th>Sales Amount</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((p: any) => (
                  <tr key={p.plan_id} className="hover:bg-slate-50/50">
                    <td className="font-semibold text-slate-800">{p.plan}</td>
                    <td>{num(p.generated)}</td>
                    <td>{num(p.sold)}</td>
                    <td>{num(p.in_stock)}</td>
                    <td>{gb(p.gb_sold)}</td>
                    <td className="font-bold text-blue-600">{rs(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && packages.length === 0 && <EmptyState>No package sales recorded for this account.</EmptyState>}
        </div>
      </GlassCard>
    </div>
  )
}
