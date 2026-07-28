import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Router, Server, Activity, ShieldCheck, ShieldAlert, Wifi, Eye, EyeOff } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { GlassCard, PageTitle, Modal, Pill, EmptyState, CustomSelect, SelectOption, Pagination, ConfirmModal, Spinner } from '../components/ui'
import { num } from '../lib/format'

const blank = { name: '', nasname: '', shortname: '', type: 'mikrotik', secret: '', description: '', status: 'active', require_message_authenticator: 'auto', owner_id: '' }

export default function Nas() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [activeTab, setActiveTab] = useState<'nas' | 'radius' | 'authlogs'>('nas')

  // NAS state
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<any>(blank)
  const [editId, setEditId] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingDeleteNas, setPendingDeleteNas] = useState<any>(null)

  // FreeRADIUS state
  const [radiusStatus, setRadiusStatus] = useState<any>(null)
  const [radiusLoading, setRadiusLoading] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restartMsg, setRestartMsg] = useState<{ success: boolean; message: string } | null>(null)
  const [testUser, setTestUser] = useState('')
  const [testPass, setTestPass] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  // Auth Logs state
  const [logs, setLogs] = useState<any[]>([])
  const [logMeta, setLogMeta] = useState<any>(null)
  const [logPage, setLogPage] = useState(1)
  const [logUserSearch, setLogUserSearch] = useState('')
  const [logReplyFilter, setLogReplyFilter] = useState('')
  const [failed24h, setFailed24h] = useState(0)
  const [bruteForceAlerts, setBruteForceAlerts] = useState<any[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, boolean>>({})

  // Clients config state
  const [clients, setClients] = useState<any[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)

  // Reseller/seller lists for assigning NAS ownership (admin only)
  const [allResellers, setAllResellers] = useState<any[]>([])
  const [allSellers, setAllSellers] = useState<any[]>([])

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users', { params: { role: 'reseller', per_page: 100 } }).then((r) => setAllResellers(r.data.data.data))
    api.get('/users', { params: { role: 'seller', per_page: 500 } }).then((r) => setAllSellers(r.data.data.data))
  }, [isAdmin])

  const ownerOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: '', label: '— Admin (Unowned) —' }]
    allResellers.forEach((r) => {
      opts.push({
        value: String(r.id),
        label: r.name,
        badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
      })
    })
    allSellers.forEach((s) => {
      opts.push({
        value: String(s.id),
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers])

  const { data: rows = [], loading: rowsLoading, refetch: load } = useQuery<any[]>('nas', () => api.get('/nas').then((r) => r.data.data))
  
  const loadRadiusStatus = () => {
    setRadiusLoading(true)
    api.get('/radius/status')
      .then((r) => setRadiusStatus(r.data.data))
      .finally(() => setRadiusLoading(false))
  }

  const restartRadius = async () => {
    setRestartMsg(null)
    const { data } = await api.post('/radius/restart')
    setRestartMsg({ success: true, message: data.message || 'FreeRADIUS restarted successfully.' })
    loadRadiusStatus()
  }

  const loadAuthLogs = (page = 1) => {
    setLogLoading(true)
    api.get('/radius/auth-logs', {
      params: {
        page,
        username: logUserSearch,
        reply: logReplyFilter
      }
    })
    .then((r) => {
      setLogs(r.data.data.logs)
      setLogMeta(r.data.data.meta)
      setLogPage(r.data.data.meta.current_page)
      setFailed24h(r.data.data.failed_24h)
      setBruteForceAlerts(r.data.data.brute_force)
    })
    .finally(() => setLogLoading(false))
  }

  const loadClientsConfig = () => {
    setClientsLoading(true)
    api.get('/radius/clients-config')
      .then((r) => setClients(r.data.data.parsed))
      .finally(() => setClientsLoading(false))
  }

  const togglePasswordReveal = (logId: number) => {
    setRevealedPasswords(prev => ({
      ...prev,
      [logId]: !prev[logId]
    }))
  }

  useEffect(() => {
    if (activeTab === 'nas') {
      load()
    } else if (activeTab === 'radius' && isAdmin) {
      loadRadiusStatus()
      loadClientsConfig()
    } else if (activeTab === 'authlogs' && isAdmin) {
      loadAuthLogs(1)
    }
  }, [activeTab, logUserSearch, logReplyFilter])

  const openNew = () => { setForm(blank); setEditId(null); setErr(''); setOpen(true) }
  const openEdit = (n: any) => { setForm({ ...blank, ...n, owner_id: n.owner_id ? String(n.owner_id) : '' }); setEditId(n.id); setErr(''); setOpen(true) }

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const payload = { ...form, owner_id: form.owner_id ? +form.owner_id : null }
      if (editId) await api.put(`/nas/${editId}`, payload)
      else await api.post('/nas', payload)
      setOpen(false); load()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  const del = (n: any) => {
    setPendingDeleteNas(n)
    setConfirmDelete(true)
  }

  const executeDeleteNas = async () => {
    if (!pendingDeleteNas) return
    try { await api.delete(`/nas/${pendingDeleteNas.id}`); load() } catch (e) { alert(apiError(e)) }
    finally { setConfirmDelete(false); setPendingDeleteNas(null) }
  }

  const runTestAuth = async () => {
    setTesting(true); setTestResult(null)
    try {
      const { data } = await api.post('/radius/test-auth', { username: testUser, password: testPass })
      setTestResult({ 
        success: data.data.status === 'Access-Accept', 
        message: data.data.message 
      })
      loadAuthLogs(1)
    } catch (e: any) {
      setTestResult({ success: false, message: e.response?.data?.message || 'Authentication failed.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <PageTitle title="NAS / Routers" subtitle="MikroTik RADIUS clients"
        icon={<Router size={22} className="text-violet-500" />}
        action={isAdmin && activeTab === 'nas' && (
          <motion.button whileTap={{ scale: 0.95 }} className="btn-primary flex items-center gap-2" onClick={openNew}>
            <Plus size={16} /> New NAS
          </motion.button>
        )} />

      {/* Tabs */}
      {isAdmin && (
        <div className="flex gap-2 mb-4 border-b border-slate-200 pb-2">
          <button 
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'nas' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => setActiveTab('nas')}
          >
            <Router size={16} /> NAS Devices
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'radius' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => setActiveTab('radius')}
          >
            <Server size={16} /> FreeRADIUS Management
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all ${activeTab === 'authlogs' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => setActiveTab('authlogs')}
          >
            <Activity size={16} /> Authentication Logs
          </button>
        </div>
      )}

      {activeTab === 'nas' ? (
        <GlassCard className="!p-0 overflow-hidden">
          {rowsLoading && rows.length === 0 ? <Spinner /> : null}
          <div className={`overflow-x-auto ${rowsLoading && rows.length === 0 ? 'hidden' : ''}`}>
            <table className="w-full">
              <thead><tr><th>Name</th><th>NAS Address</th><th>Type</th><th>Owner</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
              <tbody>
                {rows.map((n, idx) => (
                  <motion.tr key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }} className="hover:bg-secondary/30">
                    <td className="font-semibold flex items-center gap-2"><Router size={15} className="text-primary" /> {n.name}</td>
                    <td className="font-mono text-xs">{n.nasname}</td>
                    <td className="capitalize">{n.type}</td>
                    <td className="text-xs font-semibold text-slate-600">{n.owner?.name || 'Admin (Unowned)'}</td>
                    <td><Pill tone={n.status === 'active' ? 'success' : 'secondary'}>{n.status}</Pill></td>
                    {isAdmin && (
                      <td className="text-right whitespace-nowrap">
                        <button className="text-xs font-bold text-primary hover:underline mr-3" onClick={() => openEdit(n)}>Edit</button>
                        <button className="text-xs font-bold text-rose-500 hover:underline" onClick={() => del(n)}>Delete</button>
                      </td>
                    )}
                  </motion.tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <EmptyState>No NAS devices yet.</EmptyState>}
          </div>
        </GlassCard>
      ) : activeTab === 'radius' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status Panel */}
            <GlassCard className="space-y-4">
              <h3 className="font-bold flex items-center gap-2"><Server size={18} className="text-primary" /> RADIUS Server Status</h3>
              {radiusLoading && !radiusStatus ? (
                <EmptyState>Loading FreeRADIUS status…</EmptyState>
              ) : radiusStatus ? (
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-semibold">RADIUS Service Status</span>
                    <Pill tone={radiusStatus.radius_online ? 'success' : 'danger'}>
                      {radiusStatus.radius_online ? 'Online' : 'Offline'}
                    </Pill>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground font-semibold">Database Connection</span>
                    <Pill tone={radiusStatus.database_connected ? 'success' : 'danger'}>
                      {radiusStatus.database_connected ? 'Connected' : 'Disconnected'}
                    </Pill>
                  </div>
                  <div className="flex justify-between items-center text-sm pt-2 border-t">
                    <span className="text-muted-foreground">RADIUS Host</span>
                    <span className="font-mono font-semibold">{radiusStatus.radius_host}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">RADIUS Port</span>
                    <span className="font-mono font-semibold">{radiusStatus.radius_port}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm pt-2 border-t">
                    <span className="text-muted-foreground">Total Registered Credentials</span>
                    <span className="font-bold text-primary">{num(radiusStatus.stats.credentials)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Active Accounting Sessions</span>
                    <span className="font-bold text-primary">{num(radiusStatus.stats.active_sessions)}</span>
                  </div>
                  <div className="pt-2 flex items-center gap-2">
                    <button className="btn-ghost text-xs py-1" onClick={loadRadiusStatus}>Refresh Status</button>
                    <button
                      className="btn-ghost text-xs py-1 text-amber-600"
                      onClick={() => { setRestartMsg(null); setConfirmRestart(true) }}
                    >
                      Restart RADIUS Server
                    </button>
                  </div>
                  {restartMsg && (
                    <p className={`text-xs font-semibold ${restartMsg.success ? 'text-emerald-600' : 'text-red-600'}`}>
                      {restartMsg.message}
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState>Failed to load status.</EmptyState>
              )}
            </GlassCard>

            {/* Test Authentication Tool */}
            <GlassCard className="space-y-4">
              <h3 className="font-bold flex items-center gap-2"><Activity size={18} className="text-primary" /> Test RADIUS Authentication</h3>
              <div className="space-y-3">
                <input 
                  className="input" 
                  placeholder="Voucher Code / Username" 
                  value={testUser} 
                  onChange={(e) => setTestUser(e.target.value)} 
                />
                <input 
                  className="input" 
                  type="password" 
                  placeholder="Voucher Code / Password" 
                  value={testPass} 
                  onChange={(e) => setTestPass(e.target.value)} 
                />
              <motion.button 
                whileTap={{ scale: 0.95 }} 
                className="btn-primary w-full flex items-center justify-center gap-2" 
                disabled={testing || !testUser || !testPass} 
                onClick={runTestAuth}
              >
                <Wifi size={15} /> {testing ? 'Testing auth…' : 'Run PAP Authentication Test'}
              </motion.button>

              {testResult && (
                <div className={`rounded-xl p-3 border text-sm flex items-start gap-2.5 ${testResult.success ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                  {testResult.success ? <ShieldCheck size={18} className="shrink-0" /> : <ShieldAlert size={18} className="shrink-0" />}
                  <div>
                    <p className="font-bold">{testResult.success ? 'Access-Accept' : 'Access-Reject'}</p>
                    <p className="text-xs mt-0.5">{testResult.message}</p>
                  </div>
                </div>
              )}
            </div>
            </GlassCard>
          </div>

          {/* Allowable RADIUS Clients (Full Width) */}
          <GlassCard className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between p-5 pb-0">
              <h3 className="font-bold flex items-center gap-2"><Router size={18} className="text-[#003164]" /> Allowable RADIUS Clients</h3>
              <button
                onClick={() => setActiveTab('nas')}
                className="btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5 font-bold"
              >
                <Plus size={13} /> Manage Dynamic DB Clients
              </button>
            </div>
            <p className="text-[10px] text-slate-400 px-5 pt-2 font-medium leading-normal">
              Devices added from the NAS Devices tab are written directly into clients.conf and trigger a RADIUS
              restart automatically. Only "File" clients (localhost, docker_networks, etc.) are hand-maintained.
            </p>
            {clientsLoading && !clients.length ? (
              <div className="p-5"><EmptyState>Loading clients configuration…</EmptyState></div>
            ) : clients.length > 0 ? (
              <div className="overflow-x-auto mt-3 pb-3">
                <table className="w-full">
                  <thead><tr><th>Name</th><th>Source</th><th>IP / Subnet</th><th>Secret</th><th>Message-Authenticator</th></tr></thead>
                  <tbody>
                    {clients.map((c, idx) => (
                      <motion.tr key={c.ipaddr + '-' + c.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                        <td className="font-semibold text-slate-800">{c.name}</td>
                        <td>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${c.source === 'database' ? 'bg-sky-50 text-sky-600 border border-sky-100' : 'bg-slate-100 text-slate-500'}`}>
                            {c.source === 'database' ? 'DB' : 'File'}
                          </span>
                        </td>
                        <td className="font-mono text-xs text-slate-600">{c.ipaddr}</td>
                        <td className="font-mono text-xs font-bold text-[#003164]">{c.secret}</td>
                        <td className="text-xs font-semibold text-slate-600 capitalize">{c.require_message_authenticator || 'auto'}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-5"><EmptyState>No allowable clients defined.</EmptyState></div>
            )}
          </GlassCard>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Authentication Logs Card (Full Width) */}
          <GlassCard className="space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Activity size={18} className="text-[#003164]" /> RADIUS Authentication Logs</h3>
            
            {/* Brute-force & Failed Attempts Summary Alert Banner */}
            {(failed24h > 0 || bruteForceAlerts.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 select-none animate-fade-in">
                <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 flex items-center gap-3">
                  <div className="p-3 bg-rose-500 text-white rounded-xl shadow-md shadow-rose-500/20 flex items-center justify-center shrink-0">
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] text-rose-500 uppercase font-bold tracking-wider">Failed Attempts (Last 24h)</p>
                    <p className="text-xl font-extrabold text-rose-700 mt-0.5">{failed24h} failures</p>
                  </div>
                </div>

                {bruteForceAlerts.length > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
                    <div className="p-3 bg-amber-500 text-white rounded-xl shadow-md shadow-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldAlert size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] text-amber-600 uppercase font-bold tracking-wider">Potential Brute-Force Alert</p>
                      <div className="text-xs text-amber-700 font-semibold mt-1 space-y-1">
                        {bruteForceAlerts.map((bf) => (
                          <p key={bf.username}>
                            Username <span className="font-extrabold text-amber-800">"{bf.username}"</span> exceeded {bf.failures} failures (last 5 min).
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Filter controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 p-3 rounded-2xl border border-slate-100/80 mb-2 relative z-10">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <input
                  className="input !py-1.5"
                  placeholder="Filter by Username..."
                  value={logUserSearch}
                  onChange={(e) => setLogUserSearch(e.target.value)}
                />
              </div>
              <div className="w-[200px]">
                <CustomSelect
                  value={logReplyFilter}
                  onChange={setLogReplyFilter}
                  options={[
                    { value: '', label: 'All Logs' },
                    { value: 'Access-Accept', label: 'Access Accept Only' },
                    { value: 'Access-Reject', label: 'Access Reject Only' }
                  ]}
                />
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Attempted Password</th>
                    <th>Status</th>
                    <th>Attempt Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, idx) => (
                    <motion.tr key={log.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.02 }} className="hover:bg-secondary/30">
                      <td className="font-semibold text-slate-700">{log.username}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-600 bg-slate-100/50 p-1 px-2.5 rounded-lg text-xs font-semibold">
                            {revealedPasswords[log.id] ? log.pass : '••••••••'}
                          </span>
                          <button
                            onClick={() => togglePasswordReveal(log.id)}
                            className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                          >
                            {revealedPasswords[log.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </td>
                      <td>
                        <span className={`pill text-[10px] uppercase font-bold ${log.reply === 'Access-Accept' ? 'success' : 'danger'}`}>
                          {log.reply === 'Access-Accept' ? 'Accept' : 'Reject'}
                        </span>
                      </td>
                      <td className="text-xs text-slate-500 font-medium">
                        {new Date(log.authdate).toLocaleString()}
                      </td>
                    </motion.tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-slate-400 text-sm font-semibold">
                        {logLoading ? 'Loading logs...' : 'No authentication logs found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {logMeta && <Pagination meta={logMeta} onPage={loadAuthLogs} />}
          </GlassCard>
        </div>
      )}

      {/* NAS Dialog Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? 'Edit NAS' : 'New NAS'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="NAS IP / hostname" value={form.nasname} onChange={(e) => setForm({ ...form, nasname: e.target.value })} />
            <input className="input" placeholder="Short name" value={form.shortname} onChange={(e) => setForm({ ...form, shortname: e.target.value })} />
            <input className="input" placeholder="Type (mikrotik)" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
            <input className="input" placeholder="Shared secret" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
            <div className="flex flex-col min-w-[180px]">
              <CustomSelect
                value={form.status}
                onChange={(val) => setForm({ ...form, status: val })}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'disabled', label: 'Disabled' }
                ]}
              />
            </div>
            <div className="flex flex-col col-span-2">
              <CustomSelect
                value={form.require_message_authenticator}
                onChange={(val) => setForm({ ...form, require_message_authenticator: val })}
                options={[
                  { value: 'auto', label: 'Message-Authenticator: Auto (recommended)' },
                  { value: 'yes', label: 'Message-Authenticator: Always require' },
                  { value: 'no', label: 'Message-Authenticator: Never require' }
                ]}
              />
            </div>
            <div className="flex flex-col col-span-2">
              <label className="text-xs font-bold text-slate-600 block mb-1">Owner (Reseller/Seller)</label>
              <CustomSelect
                value={form.owner_id}
                onChange={(val) => setForm({ ...form, owner_id: val })}
                options={ownerOptions}
                searchable={true}
              />
            </div>
          </div>
          <input className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {err && <div className="pill danger w-full justify-center py-2">{err}</div>}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => setOpen(false)}>Cancel</button>
            <motion.button whileTap={{ scale: 0.95 }} className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save NAS'}</motion.button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={confirmDelete}
        onClose={() => { setConfirmDelete(false); setPendingDeleteNas(null) }}
        onConfirm={executeDeleteNas}
        title="Delete NAS"
        message={`Are you sure you want to delete NAS "${pendingDeleteNas?.name}"? This action cannot be undone.`}
        confirmText="Delete NAS"
      />

      <ConfirmModal
        open={confirmRestart}
        onClose={() => setConfirmRestart(false)}
        onConfirm={restartRadius}
        title="Restart RADIUS Server"
        message="Restart the FreeRADIUS server now? Active RADIUS traffic will briefly drop."
        confirmText="Restart Server"
        tone="warning"
      />
    </div>
  )
}
