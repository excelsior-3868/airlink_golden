import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Banknote, CalendarClock, Coins, History, Handshake, Layers, TrendingUp, UserPlus, Users2 } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { rs, num, date, datet } from '../lib/format'
import { StatCard, GlassCard, EmptyState } from './ui'

const shortDay = (iso: string) => iso.slice(5)

function daysLeft(iso: string): string {
  const ms = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime() - Date.now()
  const d = Math.ceil(ms / 86400000)
  return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`
}

/**
 * Operational PPPoE metrics for the dashboard (PPPoE-only installs, where there
 * are no vouchers or GB figures to show). Admins see the whole system; a reseller
 * sees only the subscribers it owns. `subscribersCard` lets the caller keep its
 * existing subscriber-status tile as the first card of the row.
 */
export default function PppoeInsights({
  metrics: m,
  role,
  subscribersCard,
}: {
  metrics: any
  role: 'admin' | 'reseller' | string
  subscribersCard?: ReactNode
}) {
  const navigate = useNavigate()
  const isAdmin = role === 'admin'
  const trend: any[] = m.daily_trend || []
  const trendHasActivity = trend.some((t) => t.revenue > 0 || t.recharges > 0 || t.new_subscribers > 0)
  const plans: any[] = m.plan_distribution || []
  const maxPlan = Math.max(1, ...plans.map((p) => p.subscribers))
  const expiring = m.expiring_soon || { count: 0, items: [], within_days: 7 }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {subscribersCard}
        <StatCard
          label="Revenue Today"
          value={<span className="text-blue-600">{rs(m.revenue.today)}</span>}
          icon={<Banknote size={22} />}
          iconColorClass="text-blue-600 bg-blue-50 border border-blue-100/50"
          sub={<span>{num(m.revenue.recharges_today)} recharges</span>}
        />
        <StatCard
          label="Revenue This Month"
          value={<span className="text-purple-600">{rs(m.revenue.month)}</span>}
          icon={<TrendingUp size={22} />}
          iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50"
          sub={<span>{num(m.revenue.recharges_month)} recharges</span>}
        />
        <StatCard
          label="New Subscribers Today"
          value={<span className="text-indigo-600">{num(m.new_subscribers.today)}</span>}
          icon={<UserPlus size={22} />}
          iconColorClass="text-indigo-600 bg-indigo-50 border border-indigo-100/50"
        />
        <StatCard
          label="New Subscribers This Month"
          value={<span className="text-cyan-600">{num(m.new_subscribers.month)}</span>}
          icon={<Users2 size={22} />}
          iconColorClass="text-cyan-600 bg-cyan-50 border border-cyan-100/50"
        />
        <motion.button
          type="button"
          onClick={() => navigate('/pppoe/customers')}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="glass-card p-5 flex items-start justify-between text-left w-full hover:-translate-y-0.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-2xl"
          title="View subscribers"
        >
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs sm:text-sm font-medium">Expiring Soon</p>
            <p className="text-xl font-bold mt-1 tracking-tight tabular-nums text-amber-600">{num(expiring.count)}</p>
            <p className="text-xs text-muted-foreground mt-1">Within the next {expiring.within_days} days</p>
          </div>
          <div className="rounded-2xl p-2.5 shrink-0 flex items-center justify-center text-amber-600 bg-amber-50 border border-amber-100/50">
            <CalendarClock size={22} />
          </div>
        </motion.button>
        <StatCard
          label={isAdmin ? 'Commission Earned This Month' : 'Your Earnings This Month'}
          value={<span className="text-emerald-600">{rs(isAdmin ? m.commission.admin_share_month : m.commission.reseller_share_month)}</span>}
          icon={<Coins size={22} />}
          iconColorClass="text-emerald-600 bg-emerald-50 border border-emerald-100/50"
          sub={isAdmin ? <span>Today: <strong className="text-slate-700">{rs(m.commission.admin_share_today)}</strong></span> : undefined}
        />
        <StatCard
          label={isAdmin ? 'Kept By Resellers This Month' : 'Commission To Admin This Month'}
          value={<span className="text-orange-600">{rs(isAdmin ? m.commission.reseller_share_month : m.commission.admin_share_month)}</span>}
          icon={<Handshake size={22} />}
          iconColorClass="text-orange-600 bg-orange-50 border border-orange-100/50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard>
          <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
            <TrendingUp size={18} /> Recharge Revenue
            <span className="ml-auto text-xs font-normal text-slate-400">Last 7 days</span>
          </h3>
          {trendHasActivity ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pppoeRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={56} />
                <Tooltip formatter={(v: any) => rs(Number(v))} labelFormatter={(l) => date(String(l))} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#6366f1" strokeWidth={2.5} fill="url(#pppoeRevGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>No recharges in the last 7 days.</EmptyState>
          )}
        </GlassCard>

        <GlassCard>
          <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
            <Users2 size={18} /> Recharges And New Subscribers
            <span className="ml-auto text-xs font-normal text-slate-400">Last 7 days</span>
          </h3>
          {trendHasActivity ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
                <Tooltip labelFormatter={(l) => date(String(l))} />
                <Legend />
                <Bar dataKey="recharges" name="Recharges" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="new_subscribers" name="New Subscribers" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>No activity in the last 7 days.</EmptyState>
          )}
        </GlassCard>

        <GlassCard>
          <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
            <CalendarClock size={18} /> Expiring Soon
            <span className="ml-auto text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-100/50 rounded-full px-2 py-0.5">
              {num(expiring.count)} in {expiring.within_days} days
            </span>
          </h3>
          {expiring.items.length === 0 ? (
            <EmptyState>No subscriptions expiring in the next {expiring.within_days} days.</EmptyState>
          ) : (
            <div className="space-y-2">
              {expiring.items.map((s: any) => (
                <div key={s.id} className="flex justify-between items-center gap-3 text-xs hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700 truncate">{s.full_name || s.username}</p>
                    <p className="text-muted-foreground mt-0.5 truncate">{s.username} · {s.plan_name}{s.phone ? ` · ${s.phone}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-amber-600 whitespace-nowrap">{daysLeft(s.expires_at)}</p>
                    <p className="text-muted-foreground mt-0.5 whitespace-nowrap">{date(s.expires_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${isAdmin ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <GlassCard>
          <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
            <History size={18} /> Recent Recharges
          </h3>
          {m.recent_recharges.length === 0 ? (
            <EmptyState>No recharges yet.</EmptyState>
          ) : (
            <div className="space-y-2">
              {m.recent_recharges.map((r: any) => (
                <div key={r.id} className="flex justify-between items-center gap-3 text-xs hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-700 truncate">{r.subscriber_name}</p>
                    <p className="text-muted-foreground mt-0.5 truncate">{r.plan_name}{isAdmin && r.reseller_name ? ` · ${r.reseller_name}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-emerald-600 whitespace-nowrap tabular-nums">{rs(r.price)}</p>
                    <p className="text-muted-foreground mt-0.5 whitespace-nowrap">{datet(r.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
            <Layers size={18} /> Subscribers By Plan
          </h3>
          {plans.length === 0 ? (
            <EmptyState>No subscribers yet.</EmptyState>
          ) : (
            <div className="space-y-3">
              {plans.map((p) => (
                <div key={p.plan_name} className="text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold text-slate-700 truncate pr-2">{p.plan_name}</span>
                    <span className="font-bold tabular-nums text-slate-700">{num(p.subscribers)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(p.subscribers / maxPlan) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {isAdmin && (
          <GlassCard>
            <h3 className="font-bold mb-3 flex items-center gap-2 text-primary">
              <Users2 size={18} /> Top Resellers This Month
            </h3>
            {(m.top_resellers || []).length === 0 ? (
              <EmptyState>No reseller recharges this month.</EmptyState>
            ) : (
              <div className="space-y-2">
                {m.top_resellers.map((t: any, i: number) => (
                  <div key={t.reseller_id} className="flex justify-between items-center gap-3 text-xs hover:bg-secondary/20 p-2 rounded-lg transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-700 truncate">{t.reseller_name}</p>
                        <p className="text-muted-foreground mt-0.5">{num(t.recharges)} recharges</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-slate-800 whitespace-nowrap tabular-nums">{rs(t.revenue)}</p>
                      <p className="text-muted-foreground mt-0.5 whitespace-nowrap">Commission {rs(t.admin_share)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        )}
      </div>
    </div>
  )
}
