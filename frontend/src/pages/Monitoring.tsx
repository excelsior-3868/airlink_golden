import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  Server,
  Cpu,
  HardDrive,
  Database,
  Wifi,
  RefreshCw,
  Router,
  CheckCircle,
  AlertCircle,
  Clock,
  Layers,
  Zap,
  Play,
  Trash2,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ArrowUpRight,
  Radio,
  Sliders,
  Check,
  Box,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { api } from '../lib/api'
import { num, formatBytes } from '../lib/format'
import {
  GlassCard,
  PageTitle,
  Pill,
  CustomSelect,
  EmptyState,
  Spinner,
  ConfirmModal,
  Toast,
  ToastState
} from '../components/ui'
import { useNavigate } from 'react-router-dom'

export default function Monitoring() {
  const navigate = useNavigate()

  // Main Data States
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [nasDevices, setNasDevices] = useState<any[]>([])
  const [nasLoading, setNasLoading] = useState(false)
  const [nasSortField, setNasSortField] = useState<'active_sessions' | 'name'>('active_sessions')
  const [nasSortOrder, setNasSortOrder] = useState<'asc' | 'desc'>('desc')
  const [lastUpdated, setLastUpdated] = useState<string>('')

  // Control States
  const [activeTab, setActiveTab] = useState<'overview' | 'nas' | 'containers' | 'actions'>('overview')
  const [refreshInterval, setRefreshInterval] = useState<number>(15)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Action States
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [radiusTestResult, setRadiusTestResult] = useState<any>(null)

  const timerRef = useRef<any>(null)

  const fetchOverview = async (showSpin = false) => {
    if (showSpin) setIsRefreshing(true)
    try {
      const res = await api.get('/admin/monitoring/overview')
      setData(res.data.data)
      setLastUpdated(new Date().toLocaleTimeString('en-US', { hour12: false }))
    } catch (err: any) {
      setToast({
        ok: false,
        text: err.response?.data?.message || err.message || 'Unable to load monitoring metrics.'
      })
    } finally {
      setLoading(false)
      if (showSpin) setIsRefreshing(false)
    }
  }

  const fetchNasStatus = async () => {
    setNasLoading(true)
    try {
      const res = await api.get('/admin/monitoring/nas-status')
      setNasDevices(res.data.data || [])
    } catch (err) {
      // Ignored non-critical failure
    } finally {
      setNasLoading(false)
    }
  }

  useEffect(() => {
    fetchOverview()
  }, [])

  useEffect(() => {
    if (activeTab === 'nas') {
      fetchNasStatus()
    }
  }, [activeTab])

  // Polling setup
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (refreshInterval > 0) {
      timerRef.current = setInterval(() => {
        fetchOverview()
        if (activeTab === 'nas') fetchNasStatus()
      }, refreshInterval * 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [refreshInterval, activeTab])

  const executeAction = async (action: string, payload: any = {}) => {
    setActionBusy(action)
    try {
      const res = await api.post('/admin/monitoring/quick-action', { action, ...payload })
      if (action === 'test_radius') {
        setRadiusTestResult(res.data.data)
      }
      setToast({
        ok: true,
        text: res.data.message || 'Operation executed successfully.'
      })
      fetchOverview()
      if (activeTab === 'nas') fetchNasStatus()
    } catch (err: any) {
      setToast({
        ok: false,
        text: err.response?.data?.message || err.message || 'Failed to complete quick action.'
      })
    } finally {
      setActionBusy(null)
    }
  }

  const formatUptime = (seconds: number) => {
    if (!seconds) return '—'
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (days > 0) return `${days}d ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m ${seconds % 60}s`
  }

  const refreshIntervalOptions = [
    { value: 5, label: 'Every 5 Seconds' },
    { value: 15, label: 'Every 15 Seconds' },
    { value: 30, label: 'Every 30 Seconds' },
    { value: 60, label: 'Every 60 Seconds' },
    { value: 0, label: 'Manual Refresh Only' }
  ]

  const system = data?.system
  const database = data?.database
  const radius = data?.radius
  const containers = data?.containers?.list || []
  const queue = data?.queue
  const network = data?.network_summary

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageTitle
          title="System & Network Monitor"
          subtitle="Real-time infrastructure health, container status, and network operations"
          icon={<Activity size={22} className="text-emerald-500" />}
        />

        {/* Live Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200/80 px-3 py-1.5 rounded-2xl text-xs font-semibold shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live Monitoring</span>
            {lastUpdated && <span className="text-[10px] text-emerald-600 font-mono">({lastUpdated})</span>}
          </div>

          <div className="w-[190px]">
            <CustomSelect
              value={refreshInterval}
              onChange={(val) => setRefreshInterval(Number(val))}
              options={refreshIntervalOptions}
            />
          </div>

          <button
            onClick={() => {
              fetchOverview(true)
              if (activeTab === 'nas') fetchNasStatus()
            }}
            disabled={isRefreshing}
            className="btn-primary py-2 px-3.5 text-xs flex items-center gap-1.5 font-bold shadow-sm cursor-pointer"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Manual Refresh</span>
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="py-24 flex flex-col items-center justify-center space-y-3">
          <Spinner />
          <p className="text-sm font-semibold text-slate-500">Loading System & Network Metrics...</p>
        </div>
      ) : (
        <>
          {/* Top Level Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* CPU Load Average */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">CPU Load Average</span>
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100/60">
                  <Cpu size={18} />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-indigo-600 tracking-tight">{system?.cpu_load?.['1m'] ?? '0.00'}</span>
                <span className="text-xs font-semibold text-indigo-400">1m average</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>5m: <strong className="text-indigo-600 font-bold">{system?.cpu_load?.['5m'] ?? '0.00'}</strong></span>
                <span>15m: <strong className="text-indigo-600 font-bold">{system?.cpu_load?.['15m'] ?? '0.00'}</strong></span>
              </div>
            </motion.div>

            {/* RAM Memory Usage */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">RAM Memory Usage</span>
                <div className="p-2 bg-sky-50 text-sky-600 rounded-xl border border-sky-100/60">
                  <Server size={18} />
                </div>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-sky-600 tracking-tight">{system?.memory?.usage_percent ?? 0}%</span>
                <span className="text-xs font-semibold text-slate-500">
                  <strong className="text-sky-700">{formatBytes(system?.memory?.used_bytes ?? 0)}</strong> / {formatBytes(system?.memory?.total_bytes ?? 0)}
                </span>
              </div>
              {/* Progress Bar */}
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    (system?.memory?.usage_percent ?? 0) > 85 ? 'bg-rose-500' : (system?.memory?.usage_percent ?? 0) > 65 ? 'bg-amber-500' : 'bg-sky-500'
                  }`}
                  style={{ width: `${Math.min(100, system?.memory?.usage_percent ?? 0)}%` }}
                />
              </div>
            </motion.div>

            {/* Disk Storage Usage */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">Disk Storage Usage</span>
                <div className="p-2 bg-purple-50 text-purple-600 rounded-xl border border-purple-100/60">
                  <HardDrive size={18} />
                </div>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black text-purple-600 tracking-tight">{system?.disk?.usage_percent ?? 0}%</span>
                <span className="text-xs font-semibold text-slate-500">
                  <strong className="text-purple-700">{formatBytes(system?.disk?.used_bytes ?? 0)}</strong> / {formatBytes(system?.disk?.total_bytes ?? 0)}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    (system?.disk?.usage_percent ?? 0) > 85 ? 'bg-rose-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${Math.min(100, system?.disk?.usage_percent ?? 0)}%` }}
                />
              </div>
            </motion.div>

            {/* System Uptime */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600">System Uptime</span>
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100/60">
                  <Clock size={18} />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-black text-emerald-600 tracking-tight truncate">
                  {formatUptime(system?.uptime_seconds ?? 0)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                <span>PHP <strong className="text-slate-700">{system?.php_version ?? '8.3'}</strong></span>
                <span className="text-emerald-600 font-bold">{system?.opcache_enabled ? 'OPcache Active' : 'OPcache Off'}</span>
              </div>
            </motion.div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2 border-b border-slate-200 pb-2">
            <button
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                activeTab === 'overview'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setActiveTab('overview')}
            >
              <Activity size={16} /> Overview & Health
            </button>
            <button
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                activeTab === 'nas'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setActiveTab('nas')}
            >
              <Router size={16} /> Network Gateways ({network?.total_nas_devices ?? 0})
            </button>
            <button
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                activeTab === 'containers'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setActiveTab('containers')}
            >
              <Box size={16} /> Docker Containers ({containers.length})
            </button>
            <button
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
                activeTab === 'actions'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setActiveTab('actions')}
            >
              <Zap size={16} /> Quick Operational Actions
            </button>
          </div>

          {/* Tab 1: Overview & Core Services */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Service Health Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* MariaDB Health */}
                <GlassCard className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <Database size={17} className="text-sky-600" /> MariaDB Database
                    </h3>
                    <Pill tone={database?.connected ? 'success' : 'danger'}>
                      {database?.connected ? 'Connected' : 'Offline'}
                    </Pill>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Query Latency:</span>
                      <span className="font-mono font-bold text-sky-600">{database?.latency_ms ?? 0} ms</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Active Threads:</span>
                      <span className="font-bold text-sky-700">{database?.threads_connected ?? 0} connected</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Total Database Size:</span>
                      <span className="font-bold text-sky-700">{database?.size_mb ?? 0} MB</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Total Queries Served:</span>
                      <span className="font-mono font-bold text-sky-600">{num(database?.total_queries ?? 0)}</span>
                    </div>
                  </div>
                </GlassCard>

                {/* FreeRADIUS Health */}
                <GlassCard className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <Radio size={17} className="text-purple-600" /> FreeRADIUS AAA Daemon
                    </h3>
                    <Pill tone={radius?.online ? 'success' : 'danger'}>
                      {radius?.online ? 'Online' : 'Unreachable'}
                    </Pill>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Server Endpoint:</span>
                      <span className="font-mono font-semibold text-slate-800">{radius?.host}:{radius?.port}</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Registered Credentials:</span>
                      <span className="font-bold text-purple-600">{num(radius?.credentials_count ?? 0)} users</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Active Sessions (Accounting):</span>
                      <span className="font-bold text-emerald-600">{num(radius?.active_sessions_count ?? 0)} live</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>24h Auth Events:</span>
                      <span className="font-semibold text-slate-700">
                        <strong className="text-emerald-600">{num(radius?.accepts_24h ?? 0)} OK</strong> / <strong className="text-rose-600">{num(radius?.rejects_24h ?? 0)} Reject</strong>
                      </span>
                    </div>
                  </div>
                </GlassCard>

                {/* Background Queue & Jobs */}
                <GlassCard className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <Layers size={17} className="text-amber-600" /> Background Queue Worker
                    </h3>
                    <Pill tone={(queue?.failed_jobs ?? 0) > 0 ? 'warning' : 'success'}>
                      {(queue?.failed_jobs ?? 0) > 0 ? 'Has Failed Jobs' : 'Healthy'}
                    </Pill>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Pending Queued Jobs:</span>
                      <span className="font-bold text-amber-600">{num(queue?.pending_jobs ?? 0)} jobs</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Failed Jobs:</span>
                      <span className={`font-bold ${queue?.failed_jobs > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {num(queue?.failed_jobs ?? 0)} failures
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Cron Scheduler:</span>
                      <span className="font-bold text-emerald-600">Active</span>
                    </div>
                    <div className="pt-1 flex justify-end">
                      {queue?.failed_jobs > 0 && (
                        <button
                          onClick={() => executeAction('retry_failed_jobs')}
                          disabled={actionBusy === 'retry_failed_jobs'}
                          className="btn-ghost py-1 px-2.5 text-[11px] text-amber-600 hover:bg-amber-50 font-bold border border-amber-200 cursor-pointer"
                        >
                          Retry Failed Jobs
                        </button>
                      )}
                    </div>
                  </div>
                </GlassCard>
              </div>

              {/* Subscriber & Table Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Network & Subscriber Load */}
                <GlassCard className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                      <Wifi size={17} className="text-emerald-600" /> Active Subscriber Load
                    </h3>
                    <button
                      onClick={() => navigate('/online-users')}
                      className="text-xs font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      View Live Sessions <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[11px] font-bold text-slate-500">Total Online</p>
                      <p className="text-2xl font-black text-emerald-600 mt-1">{num(network?.total_online_subscribers ?? 0)}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[11px] font-bold text-slate-500">Hotspot Vouchers</p>
                      <p className="text-2xl font-black text-sky-600 mt-1">{num(network?.online_hotspot_users ?? 0)}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[11px] font-bold text-slate-500">PPPoE Customers</p>
                      <p className="text-2xl font-black text-indigo-600 mt-1">{num(network?.online_pppoe_users ?? 0)}</p>
                    </div>
                  </div>
                </GlassCard>

                {/* Database Table Records */}
                <GlassCard className="space-y-4">
                  <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                    <Database size={17} className="text-[#003164]" /> Database Table Records
                  </h3>
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[11px] font-bold text-slate-500">Accounting Logs</p>
                      <p className="text-2xl font-black text-blue-600 mt-1">{num(database?.table_counts?.radacct_total ?? 0)}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[11px] font-bold text-slate-500">Voucher Cards</p>
                      <p className="text-2xl font-black text-rose-600 mt-1">{num(database?.table_counts?.vouchers_total ?? 0)}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 text-center">
                      <p className="text-[11px] font-bold text-slate-500">PPPoE Accounts</p>
                      <p className="text-2xl font-black text-purple-600 mt-1">{num(database?.table_counts?.pppoe_total ?? 0)}</p>
                    </div>
                  </div>
                </GlassCard>
              </div>
            </div>
          )}

          {/* Tab 2: Network Gateways & NAS Status */}
          {activeTab === 'nas' && (
            <GlassCard className="!p-0 overflow-hidden space-y-0">
              <div className="p-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                    <Router size={18} className="text-[#003164]" /> MikroTik Gateways & RADIUS Router Clients
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {network?.active_nas_devices ?? 0} Active · {network?.silent_nas_devices ?? 0} Silent · {network?.never_nas_devices ?? 0} Never Seen
                  </p>
                </div>
                <button
                  onClick={() => navigate('/nas')}
                  className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1 font-bold cursor-pointer"
                >
                  Manage NAS Devices <ArrowUpRight size={13} />
                </button>
              </div>

              {nasLoading && !nasDevices.length ? (
                <div className="p-12 flex justify-center"><Spinner /></div>
              ) : nasDevices.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th
                          className="cursor-pointer hover:text-primary transition-colors select-none"
                          onClick={() => {
                            if (nasSortField === 'name') {
                              setNasSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                            } else {
                              setNasSortField('name')
                              setNasSortOrder('asc')
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Gateway Name</span>
                            {nasSortField === 'name' ? (
                              nasSortOrder === 'asc' ? <ArrowUp size={13} className="text-primary" /> : <ArrowDown size={13} className="text-primary" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th>NAS IP Address</th>
                        <th>Communication Status</th>
                        <th
                          className="cursor-pointer hover:text-primary transition-colors select-none"
                          onClick={() => {
                            if (nasSortField === 'active_sessions') {
                              setNasSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                            } else {
                              setNasSortField('active_sessions')
                              setNasSortOrder('desc')
                            }
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Active Subscribers</span>
                            {nasSortField === 'active_sessions' ? (
                              nasSortOrder === 'desc' ? <ArrowDown size={13} className="text-primary" /> : <ArrowUp size={13} className="text-primary" />
                            ) : (
                              <ArrowUpDown size={12} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th>Type</th>
                        <th>Assigned Owner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...nasDevices]
                        .sort((a, b) => {
                          if (nasSortField === 'active_sessions') {
                            const valA = Number(a.active_sessions) || 0
                            const valB = Number(b.active_sessions) || 0
                            if (valA !== valB) {
                              return nasSortOrder === 'desc' ? valB - valA : valA - valB
                            }
                            return (a.name || '').localeCompare(b.name || '')
                          }
                          const nameA = (a.name || '').toString().toLowerCase()
                          const nameB = (b.name || '').toString().toLowerCase()
                          return nasSortOrder === 'desc' ? nameB.localeCompare(nameA) : nameA.localeCompare(nameB)
                        })
                        .map((n: any, idx: number) => {
                          const state = n.activity?.state || 'never'
                          return (
                            <motion.tr
                              key={n.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: idx * 0.02 }}
                              className="hover:bg-secondary/30"
                            >
                              <td className="font-semibold text-slate-800 flex items-center gap-2">
                                <Router size={15} className="text-primary" /> {n.name}
                              </td>
                              <td className="font-mono text-xs text-slate-600">
                                {n.nasname}
                                {n.coa_host && (
                                  <div className="text-[10px] text-slate-400">CoA → {n.coa_host}:{n.coa_port || 3799}</div>
                                )}
                              </td>
                              <td className="text-xs">
                                {state === 'never' ? (
                                  <span className="inline-flex items-center gap-1.5 font-bold text-slate-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300" /> Never Seen
                                  </span>
                                ) : (
                                  <div>
                                    <span className={`inline-flex items-center gap-1.5 font-bold ${state === 'active' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${state === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                                      {state === 'active' ? 'Active' : 'Silent'}
                                      {n.activity?.minutes_since !== undefined && (
                                        <span className="font-normal text-slate-400">· {n.activity.minutes_since}m ago</span>
                                      )}
                                    </span>
                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                      {num(n.activity?.packets_today || 0)} packets today
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td>
                                <span className="font-bold text-emerald-600 text-xs">
                                  {num(n.active_sessions || 0)} online
                                </span>
                              </td>
                              <td className="capitalize text-xs text-slate-600">{n.type || 'MikroTik'}</td>
                              <td className="text-xs font-semibold text-slate-600">{n.owner?.name || 'Admin'}</td>
                            </motion.tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8"><EmptyState>No NAS devices registered.</EmptyState></div>
              )}
            </GlassCard>
          )}

          {/* Tab 3: Docker Containers */}
          {activeTab === 'containers' && (
            <GlassCard className="!p-0 overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <Box size={18} className="text-[#003164]" /> Docker Service Containers
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Production application service topology</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th>Container Name</th>
                      <th>Assigned Role</th>
                      <th>Operating State</th>
                      <th>Uptime & Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containers.map((c: any, idx: number) => {
                      const isUp = c.state === 'running' || String(c.status).toLowerCase().includes('up')
                      return (
                        <motion.tr
                          key={c.name}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.02 }}
                          className="hover:bg-secondary/30"
                        >
                          <td className="font-mono text-xs font-bold text-slate-800 flex items-center gap-2">
                            <Box size={14} className="text-primary" /> {c.name}
                          </td>
                          <td className="text-xs text-slate-600 font-medium">{c.role || c.image || 'Service Container'}</td>
                          <td>
                            <Pill tone={isUp ? 'success' : 'danger'}>
                              {isUp ? 'Running' : 'Stopped'}
                            </Pill>
                          </td>
                          <td className="text-xs text-slate-500 font-mono">{c.status || 'Active'}</td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}

          {/* Tab 4: Quick Operational Actions */}
          {activeTab === 'actions' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* FreeRADIUS Management */}
              <GlassCard className="space-y-4">
                <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <Radio size={17} className="text-purple-600" /> FreeRADIUS Controls
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Restart the FreeRADIUS daemon or test authentication packet throughput.
                </p>

                <div className="space-y-3 pt-2">
                  <button
                    onClick={() => setConfirmRestart(true)}
                    disabled={actionBusy === 'restart_radius'}
                    className="btn-primary w-full py-2.5 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <RefreshCw size={14} className={actionBusy === 'restart_radius' ? 'animate-spin' : ''} />
                    Restart FreeRADIUS Server
                  </button>

                  <button
                    onClick={() => executeAction('test_radius')}
                    disabled={actionBusy === 'test_radius'}
                    className="btn-ghost w-full py-2.5 text-xs font-bold border border-slate-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck size={14} /> Send Live UDP Auth Probe Packet
                  </button>

                  {radiusTestResult && (
                    <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${radiusTestResult.online ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                      {radiusTestResult.online ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                      <span>{radiusTestResult.message}</span>
                    </div>
                  )}
                </div>
              </GlassCard>

              {/* Cache & Background Jobs */}
              <GlassCard className="space-y-4">
                <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <Zap size={17} className="text-amber-600" /> Application Maintenance
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Clear system cache or retry queued background jobs immediately.
                </p>

                <div className="space-y-3 pt-2">
                  <button
                    onClick={() => executeAction('flush_cache')}
                    disabled={actionBusy === 'flush_cache'}
                    className="btn-ghost w-full py-2.5 text-xs font-bold border border-slate-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Trash2 size={14} className="text-rose-500" /> Flush Application & Config Cache
                  </button>

                  <button
                    onClick={() => executeAction('retry_failed_jobs')}
                    disabled={actionBusy === 'retry_failed_jobs'}
                    className="btn-ghost w-full py-2.5 text-xs font-bold border border-slate-200 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Play size={14} className="text-emerald-500" /> Retry All Failed Background Jobs
                  </button>
                </div>
              </GlassCard>
            </div>
          )}
        </>
      )}

      {/* Confirm Restart Modal */}
      <ConfirmModal
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        onConfirm={() => {
          setConfirmRestart(false)
          executeAction('restart_radius')
        }}
        title="Restart FreeRADIUS Server"
        message="Are you sure you want to restart the FreeRADIUS daemon? Active authentication traffic will briefly drop for 1-2 seconds."
        confirmText="Restart Server"
        tone="warning"
      />

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
