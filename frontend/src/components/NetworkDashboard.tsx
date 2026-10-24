import { ReactNode } from 'react'
import { Activity, CalendarClock, Cable, Network, RefreshCw, Router, TrendingUp, Trophy, UserPlus, Users2, Wifi } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { num, date, parseDate } from '../lib/format'
import { bps } from '../lib/nmsFormat'
import { StatCard, GlassCard, EmptyState } from './ui'

const ROW_COLS: Record<number, string> = { 1: '', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3' }
const shortDay = (iso: string) => iso.slice(5)
const ICON_TONES: Record<string, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100/50 dark:border-emerald-900/60',
  indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100/50 dark:border-indigo-900/60',
  purple: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 border border-purple-100/50 dark:border-purple-900/60',
  amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-100/50 dark:border-amber-900/60',
  rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100/50 dark:border-rose-900/60',
  cyan: 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-100/50 dark:border-cyan-900/60',
  blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-blue-100/50 dark:border-blue-900/60',
}
const iconBox = (tone: string) => ICON_TONES[tone]

function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = Math.max(0, (Date.now() - parseDate(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const sevTone: Record<string, string> = {
  P1: 'bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60',
  P2: 'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60',
  P3: 'bg-sky-50 text-sky-700 border-sky-200/70 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/60',
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${tone}`}>{children}</span>
}

function Heading({ icon, title, note }: { icon: ReactNode; title: string; note?: string }) {
  return (
    <h3 className="font-bold mb-4 flex items-center gap-2 text-primary">
      {icon} {title}
      {note && <span className="ml-auto text-xs font-normal text-slate-400">{note}</span>}
    </h3>
  )
}

function UtilBar({ pct }: { pct: number }) {
  const tone = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

/**
 * Network and subscriber overview for admins and resellers — no money figures.
 * The server scopes everything: a reseller only receives its own subscribers
 * and the OLTs / ONTs assigned to it. `network` is null on installs without the
 * NMS, in which case only the subscriber half is shown.
 */
export default function NetworkDashboard({ metrics: m, role }: { metrics: any; role: string }) {
    const net = m.network
  const subs = m.subscribers
  const trend: any[] = m.daily_trend || []
  const trendHasActivity = trend.some((t) => t.new_subscribers > 0 || t.expired > 0 || t.recharges > 0)
  const usage: any[] = m.data_usage || []
  const usageHasActivity = usage.some((u) => u.download_gb > 0 || u.upload_gb > 0)
  const plans: any[] = m.plan_distribution || []
  const maxPlan = Math.max(1, ...plans.map((p) => p.subscribers))
  const expiring = m.expiring_soon || { count: 0, within_days: 7 }
  const resellers: any[] = m.top_resellers || []
  const nas: any[] = m.sessions_by_nas || []
  const maxNas = Math.max(1, ...nas.map((n) => n.sessions))
  const traffic: any[] = (net?.traffic || []).map((t: any) => ({ ...t, label: new Date(t.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }))
  const scopeNote = role === 'admin' ? 'Whole network' : 'Your OLTs & subscribers'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Online Now"
          value={<span className="text-emerald-600 dark:text-emerald-400">{num(m.online_now)}</span>}
          icon={<Wifi size={22} />}
          iconColorClass={iconBox('emerald')}
          sub={<span>of {num(subs.active)} active subscribers</span>}
        />
        <StatCard
          label="Subscribers"
          value={<span className="text-indigo-600 dark:text-indigo-400">{num(subs.total)}</span>}
          icon={<Router size={22} />}
          iconColorClass={iconBox('indigo')}
          sub={
            <span className="flex items-center gap-1.5 flex-wrap">
              <Badge tone="bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60">{num(subs.active)} Active</Badge>
              <Badge tone="bg-rose-50 text-rose-700 border-rose-200/70 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60">{num(subs.expired)} Expired</Badge>
              {subs.suspended > 0 && <Badge tone={sevTone.P2}>{num(subs.suspended)} Suspended</Badge>}
            </span>
          }
        />
        <StatCard
          label="New Subscribers"
          value={<span className="text-purple-600 dark:text-purple-400">{num(m.new_subscribers.today)}</span>}
          icon={<UserPlus size={22} />}
          iconColorClass={iconBox('purple')}
          sub={<span>{num(m.new_subscribers.month)} this month</span>}
        />
        <StatCard
          label="Renewals Today"
          value={<span className="text-blue-600 dark:text-blue-400">{num(m.recharges.today)}</span>}
          icon={<RefreshCw size={22} />}
          iconColorClass={iconBox('blue')}
          sub={<span>{num(m.recharges.month)} this month</span>}
        />
        <StatCard
          label="Expiring Soon"
          value={<span className="text-amber-600 dark:text-amber-400">{num(expiring.count)}</span>}
          icon={<CalendarClock size={22} />}
          iconColorClass={iconBox('amber')}
          sub={<span>within {expiring.within_days} days</span>}
        />
      </div>

      {net && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="OLT's Online"
            value={<span className={net.devices.down ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{num(net.devices.up)} / {num(net.devices.total)}</span>}
            icon={<Network size={22} />}
            iconColorClass={iconBox(net.devices.down ? 'rose' : 'emerald')}
            sub={<span>{num(net.devices.down)} down, {num(net.devices.unknown)} unknown</span>}
          />
          <StatCard
            label="ONTs Online"
            value={<span className="text-cyan-600 dark:text-cyan-400">{num(net.onts.online)} / {num(net.onts.total)}</span>}
            icon={<Cable size={22} />}
            iconColorClass={iconBox('cyan')}
            sub={<span>{num(net.onts.offline)} offline</span>}
          />
          <StatCard
            label="Weak Optical Signal"
            value={<span className={net.onts.weak_signal ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}>{num(net.onts.weak_signal)}</span>}
            icon={<Activity size={22} />}
            iconColorClass={iconBox(net.onts.weak_signal ? 'amber' : 'emerald')}
            sub={<span>online ONTs below {net.onts.weak_threshold_dbm} dBm</span>}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard>
          <Heading icon={<Users2 size={18} />} title="New, Expired & Renewed" note="Last 7 days" />
          {trendHasActivity ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
                <Tooltip labelFormatter={(l) => date(String(l))} />
                <Legend />
                <Bar dataKey="new_subscribers" name="New" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expired" name="Expired" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recharges" name="Renewed" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>No subscriber changes in the last 7 days.</EmptyState>
          )}
        </GlassCard>

        <GlassCard>
          <Heading icon={<Activity size={18} />} title="Data Usage" note="GB per day, last 7 days" />
          {usageHasActivity ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={usage} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip
                  formatter={(v: any, name: any) => [`${Number(v).toLocaleString()} GB`, String(name)]}
                  labelFormatter={(l) => date(String(l))}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  align="center"
                  iconType="rect"
                  formatter={(value) => (
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {value}
                    </span>
                  )}
                />
                <Bar dataKey="download_gb" name="Download" stackId="u" fill="#0284c7" />
                <Bar dataKey="upload_gb" name="Upload" stackId="u" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState>No usage recorded in the last 7 days.</EmptyState>
          )}
        </GlassCard>

        <GlassCard>
          <Heading icon={<Users2 size={18} />} title="Plan Mix" note="Subscribers per plan" />
          {plans.length === 0 ? (
            <EmptyState>No subscribers yet.</EmptyState>
          ) : (
            <div className="space-y-3">
              {plans.map((p) => (
                <div key={p.plan_name}>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{p.plan_name}</span>
                    <span className="tabular-nums text-slate-500">{num(p.subscribers)}</span>
                  </div>
                  <UtilBar pct={(p.subscribers / maxPlan) * 100} />
                </div>
              ))}
            </div>
          )}
        </GlassCard>

      </div>

      <div className={`grid grid-cols-1 gap-4 ${ROW_COLS[(net ? 1 : 0) + (resellers.length ? 1 : 0) + 1]}`}>
        {net && (
          <GlassCard>
            <Heading icon={<Cable size={18} />} title="OLTs" note="ONTs online" />
            {net.olts.length === 0 ? (
              <EmptyState title="No OLTs assigned" />
            ) : (
              <div className="space-y-3">
                {net.olts.map((o: any) => (
                  <div key={o.id}>
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${o.status === 'up' ? 'bg-emerald-500' : o.status === 'down' ? 'bg-rose-500' : 'bg-slate-300'}`} />
                        {o.name}
                      </span>
                      <span className="tabular-nums text-slate-500">{num(o.online)} / {num(o.onts)}</span>
                    </div>
                    <UtilBar pct={o.onts ? (o.online / o.onts) * 100 : 0} />
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        )}
        {resellers.length > 0 && (
          <GlassCard>
            <Heading icon={<Trophy size={18} />} title="Top Resellers" note="By subscribers" />
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {resellers.map((r, i) => (
                <li key={r.reseller_id} className="py-2.5 flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{r.reseller_name}</p>
                    <p className="text-xs text-slate-400">{num(r.active)} active · {num(r.online)} online · +{num(r.new_this_month)} this month</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{num(r.subscribers)}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        )}
        <GlassCard>
          <Heading icon={<Activity size={18} />} title="Top Consumers" note="Last 24 hours" />
          {m.top_consumers.length === 0 ? (
            <EmptyState>No usage recorded.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {m.top_consumers.map((c: any) => (
                <li key={c.username} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{c.full_name || c.username}</p>
                    <p className="text-xs text-slate-400 truncate">{c.username}</p>
                  </div>
                  <span className="text-xs tabular-nums text-slate-500 whitespace-nowrap">↓ {num(c.download_gb)} · ↑ {num(c.upload_gb)} GB</span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      {net && (
        <div className="grid grid-cols-1 gap-4">
          <GlassCard>
            <Heading icon={<TrendingUp size={18} />} title="Network Traffic" note={`Last 24 hours · ${scopeNote}`} />
            {traffic.length > 1 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={traffic} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trafficIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="trafficOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={32} />
                  <YAxis tick={{ fontSize: 10 }} width={64} tickFormatter={(v) => bps(Number(v))} />
                  <Tooltip formatter={(v: any) => bps(Number(v))} />
                  <Legend />
                  <Area type="monotone" dataKey="in_bps" name="In" stroke="#10b981" strokeWidth={2} fill="url(#trafficIn)" />
                  <Area type="monotone" dataKey="out_bps" name="Out" stroke="#6366f1" strokeWidth={2} fill="url(#trafficOut)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="No traffic data yet">Traffic comes from SNMP-polled interfaces marked as monitored in the NMS.</EmptyState>
            )}
          </GlassCard>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <GlassCard>
          <Heading icon={<Router size={18} />} title="Sessions By NAS" note="Online now" />
          {nas.length === 0 ? (
            <EmptyState>No live sessions.</EmptyState>
          ) : (
            <div className="space-y-3">
              {nas.map((n) => (
                <div key={n.nas_ip}>
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">{n.nas_name}</span>
                    <span className="tabular-nums text-slate-500">{num(n.sessions)}</span>
                  </div>
                  <UtilBar pct={(n.sessions / maxNas) * 100} />
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  )
}
