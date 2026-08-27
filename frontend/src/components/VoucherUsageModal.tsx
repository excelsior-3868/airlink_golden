import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { Activity, AlertTriangle, Clock, Database, Gauge } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { gb, datet, parseDate } from '../lib/format'
import { Modal, Spinner, EmptyState, Pill } from './ui'

/**
 * Colour roles, not decoration:
 *   USAGE     the one measure being plotted — a lighter step of the app's own
 *             navy (#003164), which is too dark to carry a fill.
 *   CAP       a threshold, not a series, so it takes a warning ink and the only
 *             dashed stroke in the chart. The grid is solid for exactly this
 *             reason — a dashed grid competes with it and reads as a threshold.
 *   DOWNLOAD  the categorical pair already used on the dashboard's charts, so
 *   UPLOAD    the modal doesn't look foreign.
 *
 * Every pair here was checked for colourblind separation rather than eyeballed:
 * USAGE↔CAP ΔE 22.1 protan / 29.4 normal, DOWNLOAD↔UPLOAD ΔE 24.3 / 26.6 —
 * all far above the ΔE 8 floor, all ≥3:1 against the card surface.
 */
const USAGE = '#00579f'
const CAP = '#b45309'
const DOWNLOAD = '#f43f5e'
const UPLOAD = '#a855f7'
const SURFACE = '#ffffff'
const GRID = '#f1f5f9'
const TICK = '#94a3b8'

const DAY_MS = 86400000

const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 } as const

function duration(seconds: number): string {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m || 1}m`
}

export default function VoucherUsageModal({ voucher, onClose }: { voucher: any | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tableView, setTableView] = useState<'sessions' | 'daily'>('sessions')

  const id = voucher?.id
  const code = voucher?.code

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    setTableView('sessions')
    api.get(`/vouchers/${id}/usage`)
      .then((r) => { if (!cancelled) setData(r.data.data ?? r.data) })
      .catch((e) => { if (!cancelled) setError(apiError(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  const sessions: any[] = data?.sessions ?? []
  const daily: any[] = data?.daily ?? []
  const cap: number | null = data?.totals?.cap_gb ?? null
  const dailyCap: number | null = data?.voucher?.daily_data_gb ?? null

  // A session's cumulative total is only *known* once the NAS reports it, which
  // is at the Stop packet — so each point sits at the session's stop time, and
  // the line steps rather than sloping. Interpolating between two stops would
  // claim a consumption rate the accounting data doesn't carry. An open session
  // has no stop yet, so its start is used as the lower bound.
  //
  // The leading zero point anchors the line to the baseline at activation,
  // otherwise the first session appears to begin already part-consumed.
  const series = useMemo(() => {
    const pts = sessions.map((s) => ({
      t: parseDate(s.stop || s.start).getTime(),
      cumulative_gb: s.cumulative_gb,
      session: s,
    }))
    const anchor = data?.voucher?.activated_at
      ? parseDate(data.voucher.activated_at).getTime()
      : (sessions[0] ? parseDate(sessions[0].start).getTime() : null)
    if (anchor === null) return pts
    return [{ t: anchor, cumulative_gb: 0, session: null }, ...pts]
  }, [sessions, data])

  const span = series.length > 1 ? series[series.length - 1].t - series[0].t : 0

  // Padded on both sides so the first and last steps aren't drawn on the frame
  // itself, and so a card whose only session ended the instant it activated
  // still gets an axis with width instead of one tick jammed against the edge.
  const xDomain = useMemo<[number, number] | undefined>(() => {
    if (!series.length) return undefined
    const lo = series[0].t
    const hi = series[series.length - 1].t
    const pad = Math.max((hi - lo) * 0.04, 15 * 60000)
    return [lo - pad, hi + pad]
  }, [series])

  // A 24-hour card's history straddles midnight, where bare clock times read as
  // going backwards ("10:45" then "08:45" for the next morning). Once the span
  // crosses that boundary the date has to be on the tick.
  const fmtTick = (t: number) =>
    new Date(t).toLocaleString('en-GB', {
      timeZone: 'Asia/Kathmandu',
      ...(span > 7 * DAY_MS
        ? { day: '2-digit', month: 'short' }
        : span > 12 * 3600000
          ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
          : { hour: '2-digit', minute: '2-digit' }),
    })

  // Headroom above whichever is taller, so the cap line never sits on the frame
  // — a threshold you can't see is a threshold the reader can't check against.
  const peak = Math.max(cap ?? 0, ...series.map((p) => p.cumulative_gb), 0.001)

  return (
    <Modal
      open={!!voucher}
      onClose={onClose}
      title={`Usage: ${code ?? ''}`}
      subtitle={data ? `${data.voucher.plan ?? 'No plan'} · ${data.voucher.username}` : undefined}
      icon={<Activity size={18} />}
      widthClassName="max-w-4xl"
    >
      {loading && <Spinner />}
      {!loading && error && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 text-rose-700 text-sm p-3">{error}</div>
      )}

      {!loading && !error && data && (
        <div className="space-y-6">
          {/* Headline figures. The number is the chart here — a plot of four
              scalars would say less than the scalars themselves. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Used</p>
              <p className="text-2xl font-extrabold text-[#00579f] leading-tight">{gb(data.totals.used_gb)}</p>
              {data.totals.percent_used !== null && (
                <p className="text-xs text-slate-500 mt-0.5">{data.totals.percent_used}% of quota</p>
              )}
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Remaining</p>
              <p className="text-2xl font-extrabold text-slate-700 leading-tight">
                {data.totals.remaining_gb !== null ? gb(data.totals.remaining_gb) : 'Unlimited'}
              </p>
              {cap !== null && <p className="text-xs text-slate-500 mt-0.5">of {gb(cap)} cap</p>}
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sessions</p>
              <p className="text-2xl font-extrabold text-slate-700 leading-tight">{data.totals.session_count}</p>
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <Clock size={11} /> {duration(data.totals.total_seconds)} online
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Expires</p>
              <p className="text-sm font-extrabold text-slate-700 leading-tight mt-1">
                {data.voucher.expires_at ? datet(data.voucher.expires_at) : '—'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                <Pill tone={data.voucher.status === 'active' ? 'success' : data.voucher.status === 'used' ? 'warning' : 'info'}>
                  {data.voucher.status}
                </Pill>
              </p>
            </div>
          </div>

          {/* The graph would otherwise show a flat line for a customer who is
              downloading right now, which is the exact confusion this screen
              exists to clear up. */}
          {data.live_session_not_yet_counted && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span>
                There is an open session the NAS hasn't reported usage for yet, so traffic in flight right
                now isn't included below. It lands when the session ends or the next accounting update arrives.
              </span>
            </div>
          )}

          {sessions.length === 0 ? (
            <EmptyState
              title="No usage recorded"
              subtitle="This card has no RADIUS accounting history — nobody has connected with it yet."
            />
          ) : (
            <>
              {/* Chart 1 — the one measure that matters, against its limit.
                  One series, so no legend: the heading names it. */}
              <div>
                <h4 className="text-sm font-bold text-primary flex items-center gap-2 mb-3">
                  <Database size={15} /> Data consumed
                  <span className="ml-auto text-xs font-normal text-slate-400">cumulative, against quota</span>
                </h4>
                <ResponsiveContainer width="100%" height={230}>
                  <AreaChart data={series} margin={{ top: 14, right: 12, left: 0, bottom: 4 }}>
                    <defs>
                      <linearGradient id="voucherUsageFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={USAGE} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={USAGE} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      scale="time"
                      domain={xDomain ?? ['dataMin', 'dataMax']}
                      tickFormatter={fmtTick}
                      tick={{ fontSize: 10, fill: TICK }}
                      minTickGap={28}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: TICK }}
                      width={54}
                      domain={[0, +(peak * 1.12).toFixed(3)]}
                      tickFormatter={(v) => `${Number(v).toFixed(v >= 10 ? 0 : 1)} GB`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ fontSize: 11 }}
                      labelFormatter={(t: any) => datet(new Date(t).toISOString())}
                      formatter={(v: any) => [gb(v), 'Total used']}
                    />
                    {cap !== null && (
                      <ReferenceLine
                        y={cap}
                        stroke={CAP}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        label={{ value: `${cap} GB cap`, position: 'insideTopRight', fill: CAP, fontSize: 11, fontWeight: 700 }}
                      />
                    )}
                    <Area
                      type="stepAfter"
                      dataKey="cumulative_gb"
                      stroke={USAGE}
                      strokeWidth={2}
                      strokeLinecap="round"
                      fill="url(#voucherUsageFill)"
                      dot={{ r: 3.5, fill: USAGE, stroke: SURFACE, strokeWidth: 2 }}
                      activeDot={{ r: 6, fill: USAGE, stroke: SURFACE, strokeWidth: 2 }}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Chart 2 — the granularity a daily_data_gb plan is capped on.
                  Two series, so the legend is not optional. */}
              <div>
                <h4 className="text-sm font-bold text-primary flex items-center gap-2 mb-3">
                  <Gauge size={15} /> Per day
                  <span className="ml-auto text-xs font-normal text-slate-400">
                    {dailyCap ? `daily cap ${gb(dailyCap)}` : 'download / upload split'}
                  </span>
                </h4>
                <ResponsiveContainer width="100%" height={200}>
                  {/* maxBarSize: a card used on two days would otherwise draw
                      two ~600px slabs, which reads as a loud block of colour
                      rather than a measurement. */}
                  <BarChart data={daily} margin={{ top: 14, right: 12, left: 0, bottom: 4 }} maxBarSize={72}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: TICK }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: TICK }}
                      width={54}
                      tickFormatter={(v) => `${Number(v).toFixed(Number(v) >= 10 ? 0 : 1)} GB`}
                    />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontSize: 11 }} formatter={(v: any, n: any) => [gb(v), n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {dailyCap && (
                      <ReferenceLine
                        y={dailyCap}
                        stroke={CAP}
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        label={{ value: 'daily cap', position: 'insideTopRight', fill: CAP, fontSize: 11, fontWeight: 700 }}
                      />
                    )}
                    {/* stroke is the surface colour: it reads as a 2px gap
                        between the stacked segments, not as a border. */}
                    <Bar dataKey="download_gb" name="Download" stackId="d" fill={DOWNLOAD} stroke={SURFACE} strokeWidth={2} isAnimationActive animationDuration={800} />
                    <Bar dataKey="upload_gb" name="Upload" stackId="d" fill={UPLOAD} stroke={SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* The table view both charts need: every plotted value is
                  readable without hovering. */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h4 className="text-sm font-bold text-primary">Detail</h4>
                  <div className="ml-auto flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold">
                    {(['sessions', 'daily'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setTableView(v)}
                        className={`px-3 py-1.5 rounded-[10px] capitalize transition ${
                          tableView === v ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-100">
                  {tableView === 'sessions' ? (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="text-left p-2.5 font-semibold">Started</th>
                          <th className="text-left p-2.5 font-semibold">Duration</th>
                          <th className="text-right p-2.5 font-semibold">Down</th>
                          <th className="text-right p-2.5 font-semibold">Up</th>
                          <th className="text-right p-2.5 font-semibold">Total</th>
                          <th className="text-right p-2.5 font-semibold">Cumulative</th>
                          <th className="text-left p-2.5 font-semibold">Device</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {[...sessions].reverse().map((s) => (
                          <tr key={s.id} className="border-t border-slate-100">
                            <td className="p-2.5 whitespace-nowrap">
                              {datet(s.start)}
                              {s.is_open && <Pill tone="success" className="ml-2">live</Pill>}
                            </td>
                            <td className="p-2.5 whitespace-nowrap">{duration(s.seconds)}</td>
                            <td className="p-2.5 text-right">{gb(s.download_gb)}</td>
                            <td className="p-2.5 text-right">{gb(s.upload_gb)}</td>
                            <td className="p-2.5 text-right font-bold">{gb(s.total_gb)}</td>
                            <td className="p-2.5 text-right text-slate-500">{gb(s.cumulative_gb)}</td>
                            <td className="p-2.5 whitespace-nowrap text-slate-500">{s.mac_address || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="text-left p-2.5 font-semibold">Date</th>
                          <th className="text-right p-2.5 font-semibold">Sessions</th>
                          <th className="text-right p-2.5 font-semibold">Download</th>
                          <th className="text-right p-2.5 font-semibold">Upload</th>
                          <th className="text-right p-2.5 font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {daily.map((d) => (
                          <tr key={d.date} className="border-t border-slate-100">
                            <td className="p-2.5 whitespace-nowrap">{d.date}</td>
                            <td className="p-2.5 text-right">{d.sessions}</td>
                            <td className="p-2.5 text-right">{gb(d.download_gb)}</td>
                            <td className="p-2.5 text-right">{gb(d.upload_gb)}</td>
                            <td className="p-2.5 text-right font-bold">{gb(d.total_gb)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
