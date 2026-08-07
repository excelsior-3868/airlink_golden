import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Wifi, RefreshCw, Power, Search, Database, Clock, Laptop, Users, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { formatBytes, gb, num, date, datet } from '../lib/format'
import { GlassCard, Modal, Spinner, EmptyState } from './ui'

interface OnlineSession {
  radacctid: number
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

export function OnlineUsersBadge({ onClick }: { onClick?: () => void }) {
  const navigate = useNavigate()
  const [onlineCount, setOnlineCount] = useState<number | null>(null)

  const fetchCount = async () => {
    try {
      const res = await api.get('/radius/online-users')
      if (res.data?.success) {
        setOnlineCount(res.data.data?.count ?? 0)
      }
    } catch {
      // Ignore background badge fetch errors silently
    }
  }

  useEffect(() => {
    fetchCount()
    const interval = setInterval(fetchCount, 15000)
    return () => clearInterval(interval)
  }, [])

  return (
    <button
      onClick={onClick || (() => navigate('/online-users'))}
      className="flex items-center gap-2 bg-gradient-to-r from-cyan-50 to-sky-50/70 border border-cyan-200/80 rounded-2xl py-1.5 px-3.5 shadow-xs text-xs group hover:border-cyan-300 transition-all cursor-pointer select-none"
      title="Click to View Online Users Page"
    >
      <div className="relative w-6 h-6 rounded-lg bg-cyan-500/15 text-cyan-600 flex items-center justify-center shrink-0">
        <Wifi size={13} />
        <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
      </div>
      <div className="flex flex-col leading-tight text-left">
        <span className="text-[10px] text-cyan-600 font-extrabold tracking-wide">Online Users</span>
        <span className="font-extrabold text-cyan-950 text-xs flex items-center gap-1">
          {onlineCount !== null ? num(onlineCount) : '...'} Active
        </span>
      </div>
    </button>
  )
}

export function OnlineUsersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sessions, setSessions] = useState<OnlineSession[]>([])
  const [loading, setLoading] = useState(false)
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
    if (open) {
      fetchOnlineUsers()
    }
  }, [open, search])

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

  return (
    <Modal open={open} onClose={onClose} title="Online User List" widthClassName="max-w-5xl">
      <div className="space-y-4">
        {/* Header bar & Refresh controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span>{sessions.length} Live Sessions Connected</span>
            </div>
            <span className="text-slate-300">|</span>
            <span className="text-xs text-slate-500 font-semibold">Total Volume: <b className="text-slate-800">{formatBytes(totalVolumeBytes)}</b></span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-48 sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search username, IP, MAC..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <button
              onClick={fetchOnlineUsers}
              disabled={loading}
              className="p-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-all flex items-center gap-1 text-xs font-bold px-2.5"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {msg && (
          <div
            className={`p-3 text-xs font-medium rounded-xl border flex items-start gap-2 ${
              msg.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}
          >
            {msg.ok ? <CheckCircle2 size={14} className="shrink-0 mt-px" /> : <AlertTriangle size={14} className="shrink-0 mt-px" />}
            <span>{msg.text}</span>
          </div>
        )}

        {/* Online Sessions Table */}
        <div className="overflow-x-auto border border-slate-200/80 rounded-2xl bg-white shadow-xs max-h-[60vh]">
          {loading && sessions.length === 0 ? (
            <div className="py-12"><Spinner /></div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-md z-10">
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
                  <motion.tr key={s.radacctid} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/70">
                    <td className="font-semibold text-slate-800">
                      <div>{s.voucher_code || s.username}</div>
                      {s.customer_username && (
                        <div className="text-[10px] text-slate-400 font-mono">User: {s.customer_username}</div>
                      )}
                    </td>
                    <td className="font-mono text-slate-600">{s.ip_address || '—'}</td>
                    <td className="font-mono text-xs text-slate-500">{s.mac_address || '—'}</td>
                    <td>
                      <span className="pill info font-bold">{s.plan_name || 'Standard'}</span>
                    </td>
                    <td className="text-slate-600">
                      <div>{formatDuration(s.session_time)}</div>
                      <div className="text-[10px] text-slate-400">{s.start_time ? datet(s.start_time) : ''}</div>
                    </td>
                    <td className="font-bold text-slate-700">
                      <div>{formatBytes(s.total_bytes || 0)}</div>
                      {(s.input_bytes || s.output_bytes) ? (
                        <div className="text-[10px] text-slate-400 font-normal flex items-center gap-1.5 mt-0.5">
                          <span title="Download (Rx)">↓ {formatBytes(s.output_bytes || 0)}</span>
                          <span>•</span>
                          <span title="Upload (Tx)">↑ {formatBytes(s.input_bytes || 0)}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="text-slate-500">
                      <div>{s.reseller_name || s.reseller_username || 'Admin Direct'}</div>
                      {s.seller_name && <div className="text-[10px] text-slate-400">{s.seller_name}</div>}
                    </td>
                    <td>
                      <button
                        onClick={() => handleDisconnect(s.username)}
                        disabled={disconnecting === s.username}
                        className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 hover:bg-rose-100 font-bold transition-all text-[11px] flex items-center gap-1"
                        title="Disconnect Live Session via CoA"
                      >
                        <Power size={12} />
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
      </div>
    </Modal>
  )
}
