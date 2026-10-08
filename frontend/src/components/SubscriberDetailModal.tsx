import { useEffect, useState, ReactNode } from 'react'
import { Users2 } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { api } from '../lib/api'
import { rs, num, date, datet, bsDate, formatBytes, statusPill } from '../lib/format'
import { Modal, Pill, Spinner } from './ui'

type Tab = 'info' | 'usage' | 'sessions' | 'recharges'

interface UsageDay { date: string; sessions: number; download: number; upload: number; total: number; online_seconds: number }
interface UsageData {
  days: number
  daily: UsageDay[]
  totals: { download: number; upload: number; total: number; sessions: number; online_seconds: number; average_per_day: number }
}

const USAGE_RANGES = [7, 30, 90]

const duration = (secs: number | string | null | undefined): string => {
  const s = Math.max(0, Number(secs) || 0)
  if (!s) return '—'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m`
  return m ? `${m}m ${s % 60}s` : `${s}s`
}

function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-slate-400 font-medium">{label}</div>
      <div className={`mt-0.5 text-slate-800 dark:text-slate-200 break-words ${mono ? 'font-mono' : 'font-medium'}`}>
        {children || '—'}
      </div>
    </div>
  )
}

function Section({ title, children, cols = 2 }: { title: string; children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className="p-4 bg-slate-50/80 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
      <div className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-3">{title}</div>
      <div className={`grid gap-x-4 gap-y-3 text-xs ${cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>{children}</div>
    </div>
  )
}

/**
 * Full subscriber record: profile, service, network, ownership, lifetime usage,
 * session history and recharge history. Renders nothing until `customerId` is set.
 */
export default function SubscriberDetailModal({
  customerId,
  onClose,
}: {
  customerId: number | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('info')
  const [customer, setCustomer] = useState<any>(null)
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [usageDays, setUsageDays] = useState(30)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)

  useEffect(() => {
    if (!customerId) return
    let cancelled = false
    setTab('info')
    setCustomer(null)
    setSessions([])
    setUsage(null)
    setUsageDays(30)
    setError('')
    setLoading(true)
    Promise.all([
      api.get(`/pppoe/customers/${customerId}`),
      api.get(`/pppoe/customers/${customerId}/sessions`, { params: { per_page: 100 } }),
    ])
      .then(([full, res]) => {
        if (cancelled) return
        setCustomer(full.data?.data ?? null)
        const rows = res.data?.data?.data
        setSessions(Array.isArray(rows) ? rows : [])
      })
      .catch(() => { if (!cancelled) setError('Could not load subscriber details.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [customerId])

  useEffect(() => {
    if (!customerId || tab !== 'usage') return
    let cancelled = false
    setUsageLoading(true)
    api.get(`/pppoe/customers/${customerId}/usage`, { params: { days: usageDays } })
      .then((res) => { if (!cancelled) setUsage(res.data?.data ?? null) })
      .catch(() => { if (!cancelled) setUsage(null) })
      .finally(() => { if (!cancelled) setUsageLoading(false) })
    return () => { cancelled = true }
  }, [customerId, tab, usageDays])

  const c = customer
  const live = c?.current_session
  const recharges: any[] = c?.recharges || []
  const lifetime = c?.usage_totals
  const totalPaid = recharges.reduce((sum, r) => sum + Number(r.price || 0), 0)

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`px-4 py-2 text-xs font-semibold border-b-2 transition ${
        tab === key ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500'
      }`}
    >
      {label}
    </button>
  )

  return (
    <Modal
      open={!!customerId}
      onClose={onClose}
      title={`Subscriber Details${c ? `: ${c.username}` : ''}`}
      subtitle={c ? `${c.full_name || ''}${c.customer_code ? ` · ${c.customer_code}` : ''}` : undefined}
      icon={<Users2 size={20} />}
      widthClassName="max-w-[96vw]"
      bodyClassName="overflow-y-auto h-[calc(90dvh-8rem)]"
    >
      {loading && !c ? (
        <Spinner />
      ) : error ? (
        <div className="py-10 text-center text-xs text-rose-500">{error}</div>
      ) : c ? (
        <div className="space-y-4">
          <div className="flex items-center border-b border-slate-200 dark:border-slate-800">
            {tabBtn('info', 'Overview')}
            {tabBtn('usage', 'Usage History')}
            {tabBtn('sessions', `Session History (${sessions.length})`)}
            {tabBtn('recharges', `Recharge History (${recharges.length})`)}
          </div>

          {tab === 'info' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Connection', value: c.is_online ? 'Online' : 'Offline', tone: c.is_online ? 'text-emerald-600' : 'text-slate-500' },
                  { label: 'Total Sessions', value: num(lifetime?.session_count || 0), tone: 'text-indigo-600' },
                  { label: 'Lifetime Data', value: formatBytes((lifetime?.input_bytes || 0) + (lifetime?.output_bytes || 0)), tone: 'text-purple-600' },
                  { label: 'Total Paid (recharges)', value: rs(totalPaid), tone: 'text-emerald-600' },
                ].map((k) => (
                  <div key={k.label} className="p-4 bg-white dark:bg-slate-800/40 rounded-2xl border border-slate-200/70 dark:border-slate-700/60">
                    <div className="text-[11px] font-semibold text-slate-400">{k.label}</div>
                    <div className={`text-lg font-extrabold mt-1 ${k.tone}`}>{k.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.8fr)] gap-4">
                <Section title="Profile">
                  <Field label="Username" mono>{c.username}</Field>
                  <Field label="Password" mono>{c.password}</Field>
                  <Field label="Status">
                    <Pill tone={(statusPill[c.status] as any) || 'info'} className="capitalize">{c.status}</Pill>
                  </Field>
                  <Field label="Customer Code" mono>{c.customer_code}</Field>
                  <Field label="Full Name">{c.full_name}</Field>
                  <Field label="Mobile Number" mono>{c.phone}</Field>
                  <div className="col-span-2"><Field label="Address">{c.address}</Field></div>
                  <div className="col-span-2"><Field label="Notes">{c.notes}</Field></div>
                </Section>

                <Section title="Subscription">
                  <Field label="Plan">{c.plan?.name}</Field>
                  <Field label="Bandwidth">{c.bandwidth || c.plan?.bandwidth || 'Unlimited'}</Field>
                  <Field label="Contract Price">
                    {rs(c.contract_price ?? c.plan?.selling_price ?? 0)}
                  </Field>
                  <Field label="Simultaneous Use">{c.simultaneous_use ?? 1}</Field>
                  <Field label="Expiry">
                    {c.expires_at ? (
                      <>
                        {date(c.expires_at)}
                        <div className="text-[10px] text-slate-400 font-normal">{bsDate(c.expires_at)}</div>
                      </>
                    ) : 'Not Activated'}
                  </Field>
                  <Field label="Activated">{c.activated_at ? datet(c.activated_at) : null}</Field>
                  <Field label="Last Recharged">{c.last_recharged_at ? datet(c.last_recharged_at) : null}</Field>
                  <Field label="Created">{c.created_at ? datet(c.created_at) : null}</Field>
                </Section>

                <Section title="Network & Ownership" cols={3}>
                  <Field label="Current IP" mono>{live?.framedipaddress || c.current_ip || 'Not connected'}</Field>
                  <Field label="Session MAC" mono>{live?.callingstationid}</Field>
                  <Field label="MAC Lock">{c.mac_bind ? 'Enabled' : 'Disabled'}</Field>
                  <Field label="Locked MAC" mono>{c.mac_address || (c.mac_bind ? 'Pending Login' : null)}</Field>
                  <Field label="Connected Via">{c.nas_device?.name || c.nasDevice?.name}</Field>
                  <Field label="NAS IP" mono>{live?.nasipaddress || c.nas_ip}</Field>
                  <Field label="Online Since">{live?.acctstarttime ? datet(live.acctstarttime) : null}</Field>
                  <Field label="Last Seen">{lifetime?.last_seen ? datet(lifetime.last_seen) : null}</Field>
                  <Field label="Owner">{c.owner ? `${c.owner.name} (${c.owner.role})` : null}</Field>
                  <Field label="Reseller">{c.reseller?.name}</Field>
                  <Field label="Download (lifetime)">{formatBytes(lifetime?.output_bytes || 0)}</Field>
                  <Field label="Upload (lifetime)">{formatBytes(lifetime?.input_bytes || 0)}</Field>
                  <Field label="Total Online Time">{duration(lifetime?.total_time)}</Field>
                  <Field label="First Seen">{lifetime?.first_seen ? datet(lifetime.first_seen) : null}</Field>
                </Section>
              </div>
            </div>
          )}

          {tab === 'usage' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-slate-400">
                  Daily data usage from RADIUS accounting, by the day each session started (Nepal time).
                </p>
                <div className="flex items-center gap-1 bg-slate-100/70 dark:bg-slate-800/60 p-1 rounded-full">
                  {USAGE_RANGES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setUsageDays(d)}
                      className={`px-3.5 py-1 text-xs font-semibold rounded-full transition-all ${
                        usageDays === d ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-xs' : 'text-slate-500'
                      }`}
                    >
                      Last {d} days
                    </button>
                  ))}
                </div>
              </div>

              {usageLoading && !usage ? (
                <Spinner />
              ) : !usage ? (
                <div className="py-10 text-center text-xs text-rose-500">Could not load usage history.</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: 'Total Usage', value: formatBytes(usage.totals.total), tone: 'text-purple-600' },
                      { label: 'Download', value: formatBytes(usage.totals.download), tone: 'text-indigo-600' },
                      { label: 'Upload', value: formatBytes(usage.totals.upload), tone: 'text-emerald-600' },
                      { label: 'Average / Day', value: formatBytes(usage.totals.average_per_day), tone: 'text-slate-700' },
                    ].map((k) => (
                      <div key={k.label} className="p-4 bg-white dark:bg-slate-800/40 rounded-2xl border border-slate-200/70 dark:border-slate-700/60">
                        <div className="text-[11px] font-semibold text-slate-400">{k.label}</div>
                        <div className={`text-lg font-extrabold mt-1 ${k.tone}`}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {usage.totals.total === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      No data usage recorded in the last {usage.days} days.
                    </div>
                  ) : (
                    <>
                      <div className="h-64 bg-white dark:bg-slate-800/40 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={usage.daily.map((d) => ({ ...d, label: d.date.slice(5) }))}
                            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatBytes(v)} width={64} />
                            <Tooltip formatter={(v: any) => formatBytes(Number(v))} />
                            <Legend />
                            <Bar dataKey="download" name="Download" stackId="u" fill="#6366f1" />
                            <Bar dataKey="upload" name="Upload" stackId="u" fill="#10b981" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="overflow-x-auto max-h-72">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="sticky top-0">
                            <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold">
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3 text-right">Sessions</th>
                              <th className="py-2.5 px-3 text-right">Online Time</th>
                              <th className="py-2.5 px-3 text-right">Download</th>
                              <th className="py-2.5 px-3 text-right">Upload</th>
                              <th className="py-2.5 px-3 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {[...usage.daily].reverse().map((d) => (
                              <tr key={d.date} className={`hover:bg-slate-50/50 ${d.total === 0 ? 'text-slate-400' : ''}`}>
                                <td className="py-2 px-3">{date(d.date)}</td>
                                <td className="py-2 px-3 text-right">{d.sessions}</td>
                                <td className="py-2 px-3 text-right">{duration(d.online_seconds)}</td>
                                <td className="py-2 px-3 text-right">{formatBytes(d.download)}</td>
                                <td className="py-2 px-3 text-right">{formatBytes(d.upload)}</td>
                                <td className="py-2 px-3 text-right font-bold">{formatBytes(d.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'sessions' && (
            sessions.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                No RADIUS accounting sessions recorded for this subscriber yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 font-semibold">
                      <th className="py-2.5 px-3">Start Time</th>
                      <th className="py-2.5 px-3">Stop Time</th>
                      <th className="py-2.5 px-3">Duration</th>
                      <th className="py-2.5 px-3">Session IP</th>
                      <th className="py-2.5 px-3">Caller MAC</th>
                      <th className="py-2.5 px-3">NAS IP</th>
                      <th className="py-2.5 px-3 text-right">Download</th>
                      <th className="py-2.5 px-3 text-right">Upload</th>
                      <th className="py-2.5 px-3">Terminate Cause</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sessions.map((s, idx) => (
                      <tr key={s.radacctid || idx} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3">{datet(s.acctstarttime)}</td>
                        <td className="py-2 px-3">
                          {s.acctstoptime ? datet(s.acctstoptime) : <span className="text-emerald-500 font-bold">Active Live</span>}
                        </td>
                        <td className="py-2 px-3">{duration(s.acctsessiontime)}</td>
                        <td className="py-2 px-3 font-mono">{s.framedipaddress || '—'}</td>
                        <td className="py-2 px-3 font-mono">{s.callingstationid || '—'}</td>
                        <td className="py-2 px-3 font-mono">{s.nasipaddress || '—'}</td>
                        <td className="py-2 px-3 text-right">{formatBytes(s.acctoutputoctets || 0)}</td>
                        <td className="py-2 px-3 text-right">{formatBytes(s.acctinputoctets || 0)}</td>
                        <td className="py-2 px-3">{s.acctterminatecause || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sessions.length >= 100 && (
                  <p className="text-[11px] text-slate-400 mt-2">Showing the 100 most recent sessions.</p>
                )}
              </div>
            )
          )}

          {tab === 'recharges' && (
            recharges.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">No recharge history records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/50 text-slate-500 font-semibold">
                      <th className="py-2.5 px-3">Reference</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Plan</th>
                      <th className="py-2.5 px-3 text-right">Price Paid</th>
                      <th className="py-2.5 px-3">Validity</th>
                      <th className="py-2.5 px-3">Period</th>
                      <th className="py-2.5 px-3">Payment</th>
                      <th className="py-2.5 px-3">Collected By</th>
                      <th className="py-2.5 px-3 text-right">Admin Share</th>
                      <th className="py-2.5 px-3 text-right">Reseller Share</th>
                      <th className="py-2.5 px-3">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {recharges.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50">
                        <td className="py-2 px-3 font-mono font-medium">{r.reference}</td>
                        <td className="py-2 px-3">{datet(r.created_at)}</td>
                        <td className="py-2 px-3">{r.plan?.name || '—'}</td>
                        <td className="py-2 px-3 text-right font-bold">{rs(r.price)}</td>
                        <td className="py-2 px-3">{r.validity_days} Days</td>
                        <td className="py-2 px-3 text-[11px] text-slate-500">{date(r.period_start)} → {date(r.period_end)}</td>
                        <td className="py-2 px-3 capitalize">{r.payment_method || '—'}</td>
                        <td className="py-2 px-3">{r.collected_by?.name || r.collectedBy?.name || '—'}</td>
                        <td className="py-2 px-3 text-right">{r.admin_share != null ? rs(r.admin_share) : '—'}</td>
                        <td className="py-2 px-3 text-right">{r.reseller_share != null ? rs(r.reseller_share) : '—'}</td>
                        <td className="py-2 px-3">{r.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 font-bold">
                      <td className="py-2.5 px-3" colSpan={3}>Total ({recharges.length} recharges)</td>
                      <td className="py-2.5 px-3 text-right">{rs(totalPaid)}</td>
                      <td colSpan={7} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          )}
        </div>
      ) : null}
    </Modal>
  )
}
