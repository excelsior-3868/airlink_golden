import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Wifi, RefreshCw, Power, Search, Database, Clock, Laptop, ShieldAlert, CheckCircle2, AlertTriangle, Activity, Router, Users } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes, gb, num, date, datet } from '../lib/format'
import { GlassCard, PageTitle, Spinner, EmptyState, StatCard } from '../components/ui'

interface OnlineSession {
  radacctid: number
  voucher_id?: number
  username: string
  ip_address?: string
  mac_address?: string
  nas_ip?: string
  start_time?: string
  session_time?: number
  input_bytes?: number
  output_bytes?: number
  total_bytes?: number
  voucher_code?: string
  customer_username?: string
  price?: number
  voucher_status?: string
  plan_name?: string
  package_type?: string
  reseller_username?: string
  reseller_name?: string
  seller_username?: string
  seller_name?: string
}

export default function OnlineUsers() {
  const [sessions, setSessions] = useState<OnlineSession[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
    if (!window.confirm(`Are you sure you want to disconnect live session for '${username}'?`)) {
      return
    }
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

  const totalVolumeBytes = sessions.reduce((acc, s) => acc + (s.total_bytes || 0), 0)
  const uniqueNasDevices = new Set(sessions.map((s) => s.nas_ip).filter(Boolean)).size

  return (
    <div className="space-y-6">
      <PageTitle
        title="Online Users"
        subtitle="Live RADIUS connected sessions across active hotspot networks"
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
        <StatCard
          label="Total Bandwidth Consumed"
          value={<span className="text-purple-600">{formatBytes(totalVolumeBytes)}</span>}
          icon={<Database size={22} />}
          iconColorClass="text-purple-600 bg-purple-50 border border-purple-100/50"
        />
        <StatCard
          label="Active Hotspot Gateways"
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

      {/* Main Table Card */}
      <GlassCard className="!p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Active Online Sessions</h3>
            <p className="text-xs text-slate-400">Users currently accessing the Internet through Voucher Cards & RADIUS authentication</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-64 sm:w-80">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search username, IP, MAC..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-cyan-500 shadow-xs"
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
                  <th>IP Address</th>
                  <th>MAC Address</th>
                  <th>Internet Plan</th>
                  <th>Connected Since</th>
                  <th>Data Volume</th>
                  <th>Attribution</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <motion.tr
                    key={s.voucher_id || s.radacctid}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-slate-50/70"
                  >
                    <td className="font-semibold text-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span>{s.voucher_code || s.username}</span>
                      </div>
                      {s.customer_username && (
                        <div className="text-xs text-slate-400 font-mono">User: {s.customer_username}</div>
                      )}
                    </td>
                    <td className="font-mono text-slate-600 text-xs">{s.ip_address || 'Dynamic'}</td>
                    <td className="font-mono text-xs text-slate-500">{s.mac_address || 'Active'}</td>
                    <td>
                      <span className="pill info font-bold">{s.plan_name || 'Standard'}</span>
                    </td>
                    <td className="text-xs text-slate-600">
                      <div>{formatDuration(s.session_time)}</div>
                      <div className="text-[10px] text-slate-400">{s.start_time ? datet(s.start_time) : ''}</div>
                    </td>
                    <td className="font-bold text-slate-800 text-xs">
                      <div>{formatBytes(s.total_bytes || 0)}</div>
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
                    <td>
                      <button
                        onClick={() => handleDisconnect(s.username)}
                        disabled={disconnecting === s.username}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 font-bold transition-all text-xs flex items-center gap-1.5"
                        title="Disconnect Live Session via CoA"
                      >
                        <Power size={13} />
                        {disconnecting === s.username ? '...' : 'Disconnect'}
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && sessions.length === 0 && (
            <EmptyState>No active online users connected at the moment.</EmptyState>
          )}
        </div>
      </GlassCard>
    </div>
  )
}
