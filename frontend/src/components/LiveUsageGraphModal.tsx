import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Activity,
  FileText,
  LineChart as ChartIcon,
  X,
  RefreshCw,
} from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes, datet } from '../lib/format'
import { Spinner, EmptyState } from './ui'

export type UsageRange = 'today' | 'yesterday' | '7d' | '15d' | '35d'

export interface SessionUsageData {
  customer: string
  user_id: string
  plan: string
  login_ip: string
  start_time: string | null
  caller_id: string
  nas_ip: string | null
  nas_name: string | null
  is_online: boolean
  range: UsageRange
  totals: {
    download_bytes: number
    upload_bytes: number
    total_bytes: number
    download_gb: number
    upload_gb: number
    total_gb: number
  }
  points: {
    timestamp: string
    label: string
    download_bytes: number
    upload_bytes: number
    total_bytes: number
    download_gb: number
    upload_gb: number
    total_gb: number
    download_mb: number
    upload_mb: number
    total_mb: number
  }[]
  sessions: {
    id: number
    start_time: string | null
    stop_time: string | null
    session_time: number
    download_bytes: number
    upload_bytes: number
    total_bytes: number
    download_gb: number
    upload_gb: number
    total_gb: number
    ip_address: string
    caller_id: string
    nas_ip: string
    nas_name: string
    terminate_cause: string
    is_online: boolean
  }[]
}

interface LiveUsageGraphModalProps {
  open: boolean
  onClose: () => void
  username: string | null
  sessionMeta?: {
    customer?: string
    plan?: string
    ip_address?: string
    mac_address?: string
    start_time?: string
    nas_name?: string
  }
}

export function LiveUsageGraphModal({
  open,
  onClose,
  username,
  sessionMeta,
}: LiveUsageGraphModalProps) {
  const [range, setRange] = useState<UsageRange>('35d')
  const [viewMode, setViewMode] = useState<'chart' | 'logs'>('chart')
  const [data, setData] = useState<SessionUsageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ranges: { key: UsageRange; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7D' },
    { key: '15d', label: '15D' },
    { key: '35d', label: '35D' },
  ]

  const fetchUsageData = async (selectedRange: UsageRange) => {
    if (!username) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/radius/session-usage', {
        params: {
          username,
          range: selectedRange,
        },
      })
      if (res.data?.success) {
        setData(res.data.data)
      } else {
        setError(res.data?.message || 'Failed to load usage data.')
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Error fetching live usage graph.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && username) {
      fetchUsageData(range)
    } else {
      setData(null)
      setError(null)
      setViewMode('chart')
    }
  }, [open, username, range])

  // Format Duration helper (e.g. 2h 15m 30s)
  const formatDuration = (val?: number | string) => {
    const rawSec = Number(val) || 0
    if (rawSec <= 0) return '0s'
    const seconds = rawSec > 1e8 ? Math.floor(rawSec / 1000) : rawSec
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (d > 0) return `${d}d ${h}h ${m}m`
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // Determine peak for Y-Axis domain scaling
  const maxBytes = useMemo(() => {
    if (!data?.points?.length) return 1024 * 1024
    const peaks = data.points.map((p) =>
      Math.max(p.download_bytes || 0, p.upload_bytes || 0)
    )
    return Math.max(...peaks, 1024 * 1024)
  }, [data])

  // Smart unit formatter for Y-Axis (like 0M, 9.8G, 19.5G...)
  const formatYAxis = (bytes: number) => {
    if (bytes <= 0) return '0M'
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) {
      return `${gb.toFixed(1)}G`
    }
    const mb = bytes / (1024 * 1024)
    if (mb >= 1) {
      return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)}M`
    }
    const kb = bytes / 1024
    return `${Math.round(kb)}K`
  }

  if (!open) return null

  const customerDisplay =
    data?.customer || sessionMeta?.customer || username || 'Active Subscriber'
  const userIdDisplay = data?.user_id || username || '—'
  const planDisplay = data?.plan || sessionMeta?.plan || 'Standard'
  const ipDisplay = data?.login_ip || sessionMeta?.ip_address || 'Dynamic'
  const startTimeDisplay =
    data?.start_time || sessionMeta?.start_time || null
  const callerIdDisplay =
    data?.caller_id || sessionMeta?.mac_address || 'Active'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 bg-slate-900/50 backdrop-blur-xs animate-fadeIn">
      {/* Light Mode Modal Card with Extra Width to Fit All Columns */}
      <div
        className="w-full max-w-6xl xl:max-w-7xl 2xl:max-w-[1380px] bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden text-slate-800 flex flex-col max-h-[92vh] animate-scaleUp"
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-600 shadow-xs">
              <Activity size={18} className="animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Data Usage</span>
                {data?.is_online && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Live Session
                  </span>
                )}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setViewMode((prev) => (prev === 'chart' ? 'logs' : 'chart'))
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-extrabold shadow-xs transition-all cursor-pointer"
              title="Toggle detailed session logs"
            >
              {viewMode === 'chart' ? (
                <>
                  <FileText size={13} className="text-cyan-600" />
                  <span>View Log</span>
                </>
              ) : (
                <>
                  <ChartIcon size={13} className="text-emerald-600" />
                  <span>View Graph</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all cursor-pointer"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-white">
          {viewMode === 'chart' ? (
            <>
              {/* Range Filters & Dynamic Totals Legend */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Time Range Selector Tabs */}
                <div className="flex items-center bg-slate-100 border border-slate-200/80 p-1 rounded-xl gap-1 shadow-xs">
                  {ranges.map((r) => {
                    const active = range === r.key
                    return (
                      <button
                        key={r.key}
                        onClick={() => setRange(r.key)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          active
                            ? 'bg-[#0284c7] text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                        }`}
                      >
                        {r.label}
                      </button>
                    )
                  })}
                </div>

                {/* Legend metrics with clear color dots */}
                <div className="flex items-center gap-5 text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#16a34a] shadow-xs" />
                    <span className="text-slate-600">
                      Download:{' '}
                      <span className="text-[#16a34a] font-mono font-extrabold">
                        {data
                          ? formatBytes(data.totals.download_bytes)
                          : '0.00 GB'}
                      </span>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-[#0284c7] shadow-xs" />
                    <span className="text-slate-600">
                      Upload:{' '}
                      <span className="text-[#0284c7] font-mono font-extrabold">
                        {data
                          ? formatBytes(data.totals.upload_bytes)
                          : '0.00 GB'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Chart Visual Canvas in clean light container */}
              <div className="relative bg-slate-50/70 border border-slate-200/80 rounded-2xl p-4 pt-6 shadow-xs min-h-[260px] flex items-center justify-center">
                {loading && (
                  <div className="absolute inset-0 bg-white/70 backdrop-blur-xs z-10 flex items-center justify-center rounded-2xl">
                    <Spinner />
                  </div>
                )}

                {error && !loading && (
                  <EmptyState title="Could Not Load Usage" subtitle={error} />
                )}

                {!error && data && data.points.length > 0 && (
                  <div className="w-full h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={data.points}
                        margin={{ top: 10, right: 15, left: -10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="downloadGradLight"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#16a34a"
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="95%"
                              stopColor="#16a34a"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                          <linearGradient
                            id="uploadGradLight"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="5%"
                              stopColor="#0284c7"
                              stopOpacity={0.2}
                            />
                            <stop
                              offset="95%"
                              stopColor="#0284c7"
                              stopOpacity={0.0}
                            />
                          </linearGradient>
                        </defs>

                        <CartesianGrid
                          strokeDasharray="0"
                          stroke="#e2e8f0"
                          vertical={false}
                        />

                        <XAxis
                          dataKey="label"
                          stroke="#94a3b8"
                          tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                        />

                        <YAxis
                          stroke="#94a3b8"
                          domain={[0, maxBytes * 1.15]}
                          tick={{ fill: '#64748b', fontSize: 11, fontWeight: 500 }}
                          tickFormatter={formatYAxis}
                          tickLine={false}
                          axisLine={{ stroke: '#cbd5e1' }}
                          width={48}
                        />

                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null
                            const pData = payload[0].payload
                            return (
                              <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl p-3 shadow-xl text-xs space-y-1.5 min-w-[175px]">
                                <div className="text-slate-500 font-bold border-b border-slate-100 pb-1 flex items-center justify-between">
                                  <span>{label}</span>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {pData.timestamp}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[#16a34a]">
                                  <span className="flex items-center gap-1.5 font-semibold">
                                    <span className="w-2 h-2 rounded-full bg-[#16a34a]" />
                                    Download:
                                  </span>
                                  <span className="font-mono font-extrabold">
                                    {formatBytes(pData.download_bytes)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[#0284c7]">
                                  <span className="flex items-center gap-1.5 font-semibold">
                                    <span className="w-2 h-2 rounded-full bg-[#0284c7]" />
                                    Upload:
                                  </span>
                                  <span className="font-mono font-extrabold">
                                    {formatBytes(pData.upload_bytes)}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-slate-800 border-t border-slate-100 pt-1 font-extrabold">
                                  <span>Total:</span>
                                  <span className="font-mono">
                                    {formatBytes(pData.total_bytes)}
                                  </span>
                                </div>
                              </div>
                            )
                          }}
                        />

                        <Area
                          type="monotone"
                          dataKey="download_bytes"
                          name="Download"
                          stroke="#16a34a"
                          strokeWidth={2.5}
                          fill="url(#downloadGradLight)"
                          dot={{
                            r: 3,
                            fill: '#16a34a',
                            stroke: '#ffffff',
                            strokeWidth: 1.5,
                          }}
                          activeDot={{
                            r: 5,
                            fill: '#16a34a',
                            stroke: '#ffffff',
                            strokeWidth: 2,
                          }}
                          isAnimationActive={true}
                        />

                        <Area
                          type="monotone"
                          dataKey="upload_bytes"
                          name="Upload"
                          stroke="#0284c7"
                          strokeWidth={2.5}
                          fill="url(#uploadGradLight)"
                          dot={{
                            r: 3,
                            fill: '#0284c7',
                            stroke: '#ffffff',
                            strokeWidth: 1.5,
                          }}
                          activeDot={{
                            r: 5,
                            fill: '#0284c7',
                            stroke: '#ffffff',
                            strokeWidth: 2,
                          }}
                          isAnimationActive={true}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Session Logs View in clean light table */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                  Session Accounting Log ({data?.sessions?.length || 0})
                </h3>
                <button
                  onClick={() => fetchUsageData(range)}
                  disabled={loading}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  <span>Refresh Log</span>
                </button>
              </div>

              <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100/90 text-slate-600 border-b border-slate-200 sticky top-0 font-bold">
                      <tr>
                        <th className="py-2.5 px-3">Start Time</th>
                        <th className="py-2.5 px-3">Stop Time</th>
                        <th className="py-2.5 px-3">Duration</th>
                        <th className="py-2.5 px-3">Download</th>
                        <th className="py-2.5 px-3">Upload</th>
                        <th className="py-2.5 px-3">Total</th>
                        <th className="py-2.5 px-3">IP Address</th>
                        <th className="py-2.5 px-3">Caller ID / MAC</th>
                        <th className="py-2.5 px-3">Gateway</th>
                        <th className="py-2.5 px-3">Cause</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {data?.sessions && data.sessions.length > 0 ? (
                        data.sessions.map((s) => (
                          <tr
                            key={s.id}
                            className="hover:bg-slate-50 transition-colors"
                          >
                            <td className="py-2 px-3 whitespace-nowrap text-slate-700">
                              {s.start_time ? datet(s.start_time) : '—'}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {s.is_online ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 font-sans">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                                  Online
                                </span>
                              ) : s.stop_time ? (
                                <span className="text-slate-500">
                                  {datet(s.stop_time)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-700">
                              {formatDuration(s.session_time)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-[#16a34a] font-bold">
                              {formatBytes(s.download_bytes)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-[#0284c7] font-bold">
                              {formatBytes(s.upload_bytes)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-900 font-bold">
                              {formatBytes(s.total_bytes)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-600">
                              {s.ip_address}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-600">
                              {s.caller_id}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-600 font-sans">
                              {s.nas_name || s.nas_ip}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-600 font-sans">
                              {s.terminate_cause}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={10}
                            className="py-8 text-center text-slate-400 font-sans"
                          >
                            No accounting session history recorded for this user yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Card: Current Session Metadata in clean light card */}
          <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 shadow-xs">
            <h4 className="text-xs font-extrabold text-slate-800 mb-3 tracking-wide">
              Current Session
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-6 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Customer:</span>
                <span className="text-slate-900 font-bold truncate" title={customerDisplay}>
                  {customerDisplay}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">User ID:</span>
                <span className="text-slate-900 font-mono font-bold truncate" title={userIdDisplay}>
                  {userIdDisplay}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Plan:</span>
                <span className="text-slate-900 font-bold truncate" title={planDisplay}>
                  {planDisplay}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Login IP:</span>
                <span className="text-slate-900 font-mono font-bold">
                  {ipDisplay}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Start Time:</span>
                <span className="text-slate-900 font-mono font-bold">
                  {startTimeDisplay ? datet(startTimeDisplay) : 'Active'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Caller ID:</span>
                <span className="text-slate-900 font-mono font-bold truncate" title={callerIdDisplay}>
                  {callerIdDisplay}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
