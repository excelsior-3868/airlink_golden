import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Wifi, RefreshCw, Power, Search, Database, Clock, Laptop, ShieldAlert, CheckCircle2, AlertTriangle, Activity, Router, Users } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useBranding } from '../lib/branding'
import { formatBytes, gb, num, date, datet } from '../lib/format'
import { GlassCard, PageTitle, Spinner, EmptyState, StatCard, Pagination, CustomSelect, ConfirmModal } from '../components/ui'
import { LiveUsageGraphModal } from '../components/LiveUsageGraphModal'
import SubscriberDetailModal from '../components/SubscriberDetailModal'

interface OnlineSession {
  radacctid: number
  voucher_id?: number
  pppoe_customer_id?: number
  connection_type?: 'hotspot' | 'pppoe'
  username: string
  ip_address?: string
  mac_address?: string
  nas_ip?: string
  nas_name?: string
  start_time?: string
  session_time?: number
  input_bytes?: number
  output_bytes?: number
  total_bytes?: number
  voucher_code?: string
  customer_username?: string
  price?: number
  voucher_status?: string
  is_stale_session?: boolean
  plan_name?: string
  package_type?: string
  reseller_username?: string
  reseller_name?: string
  seller_username?: string
  seller_name?: string
}

export default function OnlineUsers() {
  const { user } = useAuth()
  const pppoeOnly = useBranding().branding.pppoe_only
  const isSeller = user?.role === 'seller'

  const [sessions, setSessions] = useState<OnlineSession[]>([])
  const [loading, setLoading] = useState(true)
  const [detailCustomerId, setDetailCustomerId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'hotspot' | 'pppoe'>('all')
  const [nasFilter, setNasFilter] = useState('all')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState<{ open: boolean; username: string | null; label: string | null }>({ open: false, username: null, label: null })
  const [selectedForUsage, setSelectedForUsage] = useState<OnlineSession | null>(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const perPageOptions = [
    { value: 10, label: '10 / Page' },
    { value: 25, label: '25 / Page' },
    { value: 50, label: '50 / Page' },
    { value: 100, label: '100 / Page' },
  ]

  const nasOptions = useMemo(() => {
    const map = new Map<string, { name: string; ip: string; count: number }>()
    sessions.forEach((s) => {
      if (s.nas_ip) {
        const key = s.nas_ip
        const name = s.nas_name || s.nas_ip
        const existing = map.get(key)
        if (existing) {
          existing.count += 1
        } else {
          map.set(key, { name, ip: s.nas_ip, count: 1 })
        }
      }
    })
    const list = Array.from(map.entries()).map(([ip, item]) => ({
      value: ip,
      label: item.name,
      keywords: `${item.name} ${item.ip}`,
      badge: (
        <span className="text-[10px] text-slate-400 tabular-nums font-mono">
          {item.count}
        </span>
      ),
    }))
    list.sort((a, b) => a.label.localeCompare(b.label))
    return [{ value: 'all', label: 'All Gateways' }, ...list]
  }, [sessions])

  const fetchOnlineUsers = async () => {
    setLoading(true)
    try {
      const res = await api.get('/radius/online-users', { params: { search: search || undefined } })
      if (res.data?.success) {
        setSessions(res.data.data?.sessions || [])
      }
    } catch {
      // Handle error gracefully
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOnlineUsers()
    const interval = setInterval(fetchOnlineUsers, 10000)
    return () => clearInterval(interval)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [search, typeFilter, nasFilter])

  useEffect(() => {
    const timer = setInterval(() => {
      setSessions((prev) =>
        prev.map((s) => ({
          ...s,
          session_time: (Number(s.session_time) || 0) + 1,
        }))
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleDisconnect = async (username: string) => {
    setDisconnecting(username)
    setMsg(null)
    try {
      // The API reports what the router actually answered — a 422 means no CoA
      // packet landed, so don't claim success on its behalf.
      const res = await api.post('/radius/disconnect-user', { username })
      setMsg({ ok: true, text: res.data?.message || `Disconnected ${username}.` })
      await fetchOnlineUsers()
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.message || `Failed to disconnect ${username}.` })
    } finally {
      setDisconnecting(null)
    }
  }

  const formatDuration = (val?: number | string) => {
    const rawSec = Number(val) || 0
    if (rawSec <= 0) return 'Just now'
    const seconds = rawSec > 1e8 ? Math.floor(rawSec / 1000) : rawSec
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  // Hotspot and PPPoE share one radacct feed; connection_type separates them.
  // Filtering is client-side because the whole live list is already in memory.
  const hotspotCount = sessions.filter((s) => s.connection_type !== 'pppoe').length
  const pppoeCount = sessions.filter((s) => s.connection_type === 'pppoe').length
  const visibleSessions = sessions
    .filter((s) => {
      if (pppoeOnly) return s.connection_type === 'pppoe'
      if (isSeller) return true
      if (typeFilter !== 'all' && (s.connection_type ?? 'hotspot') !== typeFilter) return false
      return true
    })
    .filter((s) => {
      if (nasFilter === 'all') return true
      return s.nas_ip === nasFilter || s.nas_name === nasFilter
    })

  const totalItems = visibleSessions.length
  const lastPage = Math.max(1, Math.ceil(totalItems / perPage))
  const currentPage = Math.min(page, lastPage)
  const pagedSessions = visibleSessions.slice((currentPage - 1) * perPage, currentPage * perPage)
  const pageMeta = {
    current_page: currentPage,
    last_page: lastPage,
    per_page: perPage,
    total: totalItems,
    from: totalItems === 0 ? 0 : (currentPage - 1) * perPage + 1,
    to: Math.min(currentPage * perPage, totalItems),
  }

  // Summary cards describe every live session, not the tab-filtered slice —
  // the Hotspot/PPPoE tabs scope the table below, not the totals above it.
  const bytesOf = (rows: OnlineSession[]) => rows.reduce((acc, s) => acc + (s.total_bytes || 0), 0)
  const totalVolumeBytes = bytesOf(sessions)
  const hotspotVolumeBytes = bytesOf(sessions.filter((s) => s.connection_type !== 'pppoe'))
  const pppoeVolumeBytes = bytesOf(sessions.filter((s) => s.connection_type === 'pppoe'))
  const uniqueNasDevices = new Set(sessions.map((s) => s.nas_ip).filter(Boolean)).size

  // Sessions whose owning account isn't 'active' shouldn't exist — either the
  // suspend/expire→disconnect pipeline hasn't caught up yet, or its CoA kick
  // failed/was skipped (unregistered NAS). Surface them so an operator can
  // manually disconnect rather than assuming "online" means "entitled".
  const staleCount = sessions.filter((s) => s.is_stale_session).length

  const typeTabs: { key: 'all' | 'hotspot' | 'pppoe'; label: string; count: number }[] = pppoeOnly
    ? []
    : [
        { key: 'all', label: 'All', count: sessions.length },
        { key: 'hotspot', label: 'Hotspot', count: hotspotCount },
        { key: 'pppoe', label: 'PPPoE', count: pppoeCount },
      ]

  return (
    <div className="space-y-6">
      <PageTitle
        title="Online Users"
        subtitle={isSeller ? "Live RADIUS sessions for hotspot vouchers" : "Live RADIUS sessions across hotspot vouchers and PPPoE subscribers"}
        icon={<Wifi size={22} className="text-cyan-500" />}
        action={
          <button
            onClick={fetchOnlineUsers}
            disabled={loading}
            className="btn-ghost flex items-center gap-2 text-xs font-bold"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh List</span>
          </button>
        }
      />

      {/* Top Stat Summary Cards */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isSeller ? 'lg:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-5'} gap-4`}>
        <StatCard
          label="Live Online Users"
          value={
            <span className="flex items-center gap-2 text-cyan-600">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              {num(sessions.length)}
            </span>
          }
          icon={<Users size={22} />}
          iconColorClass="text-cyan-600 bg-cyan-50 border border-cyan-100/50"
        />
        {!pppoeOnly && (
        <StatCard
            label="Hotspot Users Online"
            value={<span className="text-sky-600">{num(hotspotCount)}</span>}
            sub={`${formatBytes(hotspotVolumeBytes)} consumed`}
            icon={<Wifi size={22} />}
            iconColorClass="text-sky-600 bg-sky-50 border border-sky-100/50"
          />
        )}
        {!isSeller && (
          <StatCard
            label="PPPoE Subscribers Online"
            value={<span className="text-indigo-600">{num(pppoeCount)}</span>}
            sub={`${formatBytes(pppoeVolumeBytes)} consumed`}
            icon={<Activity size={22} />}
            iconColorClass="text-indigo-600 bg-indigo-50 border border-indigo-100/50"
          />
        )}
        <StatCard
          label="Total Bandwidth Consumed"
          value={<span className="text-purple-600">{formatBytes(totalVolumeBytes)}</span>}
          icon={<Database size={22} />}
          iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50"
        />
        <StatCard
          label="Active Gateways"
          value={<span className="text-emerald-600">{num(uniqueNasDevices)}</span>}
          icon={<Router size={22} />}
          iconColorClass="text-emerald-600 bg-emerald-50 border border-emerald-100/50"
        />
      </div>

      {msg && (
        <div
          className={`p-3 text-xs font-medium rounded-2xl border flex items-start gap-2 ${
            msg.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          {msg.ok ? <CheckCircle2 size={15} className="shrink-0 mt-px" /> : <AlertTriangle size={15} className="shrink-0 mt-px" />}
          <span>{msg.text}</span>
        </div>
      )}

      {staleCount > 0 && (
        <div className="p-3 text-xs font-medium rounded-2xl border flex items-start gap-2 bg-amber-50 border-amber-200 text-amber-800">
          <ShieldAlert size={15} className="shrink-0 mt-px" />
          <span>
            {staleCount} session{staleCount > 1 ? 's are' : ' is'} online for an account that is not active (suspended, expired, or otherwise not
            entitled). Look for the <span className="font-bold">Stale</span> badge below and disconnect manually if the router hasn't dropped it yet.
          </span>
        </div>
      )}

      {/* Main Table Card */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Active Online Sessions</h3>
            <p className="text-xs text-slate-400">
              {isSeller
                ? 'Hotspot voucher sessions, live from RADIUS accounting'
                : 'Hotspot voucher and PPPoE subscriber sessions, live from RADIUS accounting'}
            </p>
            {!isSeller && (
              <div className="flex items-center gap-1.5 mt-2.5">
                {typeTabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => {
                      setTypeFilter(t.key)
                      setPage(1)
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                      typeFilter === t.key
                        ? 'bg-cyan-50 border-cyan-200 text-cyan-700'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {t.label} <span className="tabular-nums opacity-70">({t.count})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <div className="relative w-44 sm:w-56 shrink-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search online sessions..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="w-full text-xs pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-cyan-500 shadow-xs"
              />
            </div>
            <div className="w-44 sm:w-52 shrink-0">
              <CustomSelect
                className="w-full !min-w-0"
                buttonClassName="!py-2 !px-3 !rounded-xl !text-xs !shadow-xs !border-slate-200"
                options={nasOptions}
                value={nasFilter}
                onChange={(val) => {
                  setNasFilter(String(val))
                  setPage(1)
                }}
                searchable={nasOptions.length > 5}
              />
            </div>
            <div className="w-28 shrink-0">
              <CustomSelect
                className="w-full !min-w-0"
                buttonClassName="!py-2 !px-3 !rounded-xl !text-xs !shadow-xs !border-slate-200"
                options={perPageOptions}
                value={perPage}
                onChange={(val) => {
                  setPerPage(Number(val))
                  setPage(1)
                }}
                searchable={false}
              />
            </div>
            <button
              onClick={fetchOnlineUsers}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-extrabold text-xs shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
              title="Refresh Connected Since & Data Volume"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-cyan-600' : 'text-slate-500'} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading && sessions.length === 0 ? (
            <div className="py-16"><Spinner /></div>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th>Username / Voucher</th>
                  {!isSeller && <th>Type</th>}
                  <th>IP Address</th>
                  <th>MAC Address</th>
                  <th>Connected Via</th>
                  <th>Internet Plan</th>
                  <th>Connected Since</th>
                  <th>Data Volume</th>
                  <th>Attribution</th>
                  <th className="text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedSessions.map((s) => (
                  <motion.tr
                    key={s.radacctid}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => { if (s.pppoe_customer_id) setDetailCustomerId(s.pppoe_customer_id) }}
                    title={s.pppoe_customer_id ? 'Click to view subscriber details' : undefined}
                    className={`${s.is_stale_session ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-slate-50/70'} ${s.pppoe_customer_id ? 'cursor-pointer' : ''}`}
                  >
                    <td className="font-semibold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        {s.is_stale_session ? (
                          <span title={`Account status is '${s.voucher_status || 'inactive'}' — this session should not still be online.`}>
                            <ShieldAlert size={12} className="text-amber-600 shrink-0" />
                          </span>
                        ) : (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        )}
                        <span>{s.voucher_code || s.username}</span>
                        {s.is_stale_session && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200"
                            title={`Account status: ${s.voucher_status || 'inactive'}`}
                          >
                            Stale
                          </span>
                        )}
                      </div>
                      {s.customer_username && (
                        <div className="text-xs text-slate-400 font-mono">User: {s.customer_username}</div>
                      )}
                    </td>
                    {!isSeller && (
                      <td>
                        {s.connection_type === 'pppoe' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200/70 dark:bg-indigo-950/40 dark:text-indigo-300">
                            <Activity size={10} /> PPPoE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200/70 dark:bg-cyan-950/40 dark:text-cyan-300">
                            <Wifi size={10} /> Hotspot
                          </span>
                        )}
                      </td>
                    )}
                    <td className="font-mono text-slate-600 text-xs">
                      {s.ip_address && /^\d{1,3}(\.\d{1,3}){3}$/.test(s.ip_address) ? (
                        <a
                          href={`http://${s.ip_address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Open http://${s.ip_address} in a new tab`}
                          className="text-indigo-600 hover:text-indigo-800 hover:underline underline-offset-2"
                        >
                          {s.ip_address}
                        </a>
                      ) : (
                        s.ip_address || 'Dynamic'
                      )}
                    </td>
                    <td className="font-mono text-xs text-slate-500">{s.mac_address || 'Active'}</td>
                    {/* Which router the session came in on. Registered NAS
                        devices resolve to their friendly name with the IP
                        underneath; an unregistered gateway shows the bare IP. */}
                    <td className="text-xs">
                      {s.nas_ip ? (
                        <div className="flex items-center gap-1.5">
                          <Router size={13} className="text-emerald-500 shrink-0" />
                          <div className="leading-tight">
                            <div className="font-semibold text-slate-700">{s.nas_name || s.nas_ip}</div>
                            {s.nas_name && <div className="text-[10px] text-slate-400 font-mono">{s.nas_ip}</div>}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Unknown</span>
                      )}
                    </td>
                    <td>
                      <span className="pill info font-bold">{s.plan_name || 'Standard'}</span>
                    </td>
                    <td className="text-xs text-slate-600">
                      <div>{formatDuration(s.session_time)}</div>
                      <div className="text-[10px] text-slate-400">{s.start_time ? datet(s.start_time) : ''}</div>
                    </td>
                    <td
                      className="font-bold text-slate-800 text-xs cursor-pointer group"
                      onClick={(e) => { e.stopPropagation(); setSelectedForUsage(s) }}
                      title="Click to view live data usage graph"
                    >
                      <div className="group-hover:text-cyan-600 transition-colors flex items-center gap-1">
                        <span>{formatBytes(s.total_bytes || 0)}</span>
                        <Activity size={12} className="opacity-0 group-hover:opacity-100 text-cyan-500 transition-opacity" />
                      </div>
                      {(s.input_bytes || s.output_bytes) ? (
                        <div className="text-[10px] text-slate-400 font-normal flex items-center gap-1.5 mt-0.5">
                          <span title="Download (Rx)">↓ {formatBytes(s.output_bytes || 0)}</span>
                          <span>•</span>
                          <span title="Upload (Tx)">↑ {formatBytes(s.input_bytes || 0)}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="text-xs text-slate-500">
                      <div>{s.reseller_name || s.reseller_username || 'Admin Direct'}</div>
                      {s.seller_name && <div className="text-[10px] text-slate-400">{s.seller_name}</div>}
                    </td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setSelectedForUsage(s)}
                          aria-label={`View Data Usage Graph for ${s.voucher_code || s.username}`}
                          className="w-8 h-8 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100 transition-all flex items-center justify-center cursor-pointer shadow-xs"
                          title={`View live data usage graph for ${s.voucher_code || s.username}`}
                        >
                          <Activity size={14} className="text-cyan-600" />
                        </button>
                        <button
                          onClick={() => setConfirmDisconnect({ open: true, username: s.username, label: s.voucher_code || s.username })}
                          disabled={disconnecting === s.username}
                          aria-label={`Disconnect ${s.voucher_code || s.username}`}
                          className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 disabled:opacity-60 transition-all flex items-center justify-center cursor-pointer shadow-xs"
                          title={`Disconnect live session for ${s.voucher_code || s.username} via CoA`}
                        >
                          <Power size={14} className={disconnecting === s.username ? 'animate-pulse' : ''} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && visibleSessions.length === 0 && (
            <EmptyState>
              {isSeller
                ? 'No active online voucher sessions connected at the moment.'
                : nasFilter !== 'all'
                ? `No online sessions connected via ${nasOptions.find((o) => o.value === nasFilter)?.label || nasFilter} right now.`
                : typeFilter === 'all'
                ? 'No active online users connected at the moment.'
                : `No ${typeFilter === 'pppoe' ? 'PPPoE' : 'hotspot'} sessions are online right now.`}
            </EmptyState>
          )}
        </div>

        {visibleSessions.length > 0 && (
          <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800">
            <Pagination meta={pageMeta} onPage={setPage} />
          </div>
        )}
      </GlassCard>

      <LiveUsageGraphModal
        open={!!selectedForUsage}
        onClose={() => setSelectedForUsage(null)}
        username={selectedForUsage?.voucher_code || selectedForUsage?.username || null}
        sessionMeta={{
          customer: selectedForUsage?.customer_username || selectedForUsage?.username,
          plan: selectedForUsage?.plan_name,
          ip_address: selectedForUsage?.ip_address,
          mac_address: selectedForUsage?.mac_address,
          start_time: selectedForUsage?.start_time,
          nas_name: selectedForUsage?.nas_name,
        }}
      />

      <ConfirmModal
        open={confirmDisconnect.open}
        onClose={() => setConfirmDisconnect({ open: false, username: null, label: null })}
        onConfirm={() => handleDisconnect(confirmDisconnect.username!)}
        title="Disconnect Session"
        message={`Are you sure you want to disconnect live session for '${confirmDisconnect.label}'?`}
        confirmText="Disconnect"
        tone="danger"
      />
      <SubscriberDetailModal customerId={detailCustomerId} onClose={() => setDetailCustomerId(null)} />
    </div>
  )
}
