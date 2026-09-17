import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle,
  XCircle,
  HelpCircle,
  Activity,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Wifi,
  FileText,
  Search,
  X,
  Eye,
  EyeOff,
  Terminal,
  ArrowRight
} from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { num, datet } from '../lib/format'
import { GlassCard, PageTitle, Pill, CustomSelect, EmptyState, Pagination, Spinner } from '../components/ui'

export default function RadiusLogs() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [activeTab, setActiveTab] = useState<'diagnostics' | 'serverlog' | 'authlogs'>('diagnostics')

  // Log Availability State
  const [logAvailable, setLogAvailable] = useState<boolean | null>(null)
  const [logCheckError, setLogCheckError] = useState<string | null>(null)

  // Diagnostics State
  const [diagCode, setDiagCode] = useState('')
  const [diagMac, setDiagMac] = useState('')
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagResults, setDiagResults] = useState<any>(null)
  const [diagError, setDiagError] = useState<string | null>(null)

  // Server Log State
  const [serverLog, setServerLog] = useState<any>(null)
  const [serverLogLoading, setServerLogLoading] = useState(false)
  const [serverLogLimit, setServerLogLimit] = useState<number>(500)
  const [serverLogSearch, setServerLogSearch] = useState<string>('')
  const [serverLogFilterInput, setServerLogFilterInput] = useState<string>('')

  // Authentication Logs State (Admin)
  const [authLogs, setAuthLogs] = useState<any[]>([])
  const [authLogMeta, setAuthLogMeta] = useState<any>(null)
  const [authLogLoading, setAuthLogLoading] = useState(false)
  const [authLogUserSearch, setAuthLogUserSearch] = useState('')
  const [authLogReplyFilter, setAuthLogReplyFilter] = useState('')
  const [failed24h, setFailed24h] = useState(0)
  const [bruteForceAlerts, setBruteForceAlerts] = useState<any[]>([])
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, boolean>>({})

  // Availability check
  const checkLogAvailability = async () => {
    try {
      const response = await api.get('/radius/server-log', { params: { limit: 1 } })
      if (response.data.data?.exists === false) {
        setLogAvailable(false)
        setLogCheckError(response.data.data.message || 'FreeRADIUS log file not found or not readable.')
      } else {
        setLogAvailable(true)
        setLogCheckError(null)
      }
    } catch (err: any) {
      setLogAvailable(false)
      setLogCheckError(err.response?.data?.message || err.message || 'Failed to reach the RADIUS log endpoint.')
    }
  }

  useEffect(() => {
    checkLogAvailability()
  }, [])

  // Run single-voucher deep diagnostic
  const runDiagnostics = async (codeToRun?: string) => {
    const code = (codeToRun ?? diagCode).trim()
    if (!code) return
    setDiagLoading(true)
    setDiagError(null)
    setDiagResults(null)

    try {
      // Without a MAC the probe sends no Calling-Station-Id, so any
      // MAC-bound voucher comes back as a mismatch against an empty
      // string. Blank here means "use the voucher's own bound MAC".
      const response = await api.get(`/radius/diagnose/${encodeURIComponent(code)}`, {
        params: { mac: diagMac.trim() || undefined },
      })
      setDiagResults(response.data.data)
    } catch (err: any) {
      setDiagError(err.response?.data?.message || err.message || 'Diagnostics request failed.')
    } finally {
      setDiagLoading(false)
    }
  }

  // Load Server Log
  const loadServerLog = (limit = serverLogLimit, search = serverLogFilterInput) => {
    setServerLogLoading(true)
    setServerLogSearch(search)
    api.get('/radius/server-log', { params: { limit, search: search || undefined } })
      .then((r) => setServerLog(r.data.data))
      .catch((err: any) => {
        setServerLog({
          exists: false,
          message: err.response?.data?.message || err.message || 'Failed to load FreeRADIUS server log.'
        })
      })
      .finally(() => setServerLogLoading(false))
  }

  // Load Authentication Logs
  const loadAuthLogs = (page = 1) => {
    if (!isAdmin) return
    setAuthLogLoading(true)
    api.get('/radius/auth-logs', {
      params: {
        page,
        username: authLogUserSearch || undefined,
        reply: authLogReplyFilter || undefined
      }
    })
      .then((r) => {
        setAuthLogs(r.data.data.logs || [])
        setAuthLogMeta(r.data.data.meta)
        setFailed24h(r.data.data.failed_24h || 0)
        setBruteForceAlerts(r.data.data.brute_force || [])
      })
      .catch(() => {
        setAuthLogs([])
      })
      .finally(() => setAuthLogLoading(false))
  }

  useEffect(() => {
    if (activeTab === 'serverlog') {
      loadServerLog(serverLogLimit, serverLogFilterInput)
    } else if (activeTab === 'authlogs' && isAdmin) {
      loadAuthLogs(1)
    }
  }, [activeTab, authLogUserSearch, authLogReplyFilter])

  // MikroTik's hotspot logs its users in over CHAP, so radpostauth.pass holds
  // the CHAP-Password blob ("0x…"), not what the customer typed — the plaintext
  // never reaches RADIUS at all. Revealing it shows hex garbage, which reads as
  // "they got the password wrong" and is the single most misleading thing on
  // this page when the real reject reason was MAC binding or an expired card.
  const isChapBlob = (pass?: string) => !!pass && /^0x[0-9a-f]+$/i.test(pass)

  const togglePasswordReveal = (logId: number) => {
    setRevealedPasswords((prev) => ({
      ...prev,
      [logId]: !prev[logId]
    }))
  }

  const navigateToLogWithSearch = (keyword: string) => {
    setServerLogFilterInput(keyword)
    setActiveTab('serverlog')
    loadServerLog(serverLogLimit, keyword)
  }

  const statusTone = (status: string) => (status === 'success' ? 'success' : status === 'error' ? 'danger' : 'warning')

  const limitOptions = [
    { value: 200, label: 'Last 200 Lines' },
    { value: 500, label: 'Last 500 Lines' },
    { value: 1000, label: 'Last 1,000 Lines' },
    { value: 5000, label: 'Last 5,000 Lines' }
  ]

  const replyOptions = [
    { value: '', label: 'All Authentication Logs' },
    { value: 'Access-Accept', label: 'Access Accept Only' },
    { value: 'Access-Reject', label: 'Access Reject Only' }
  ]

  return (
    <div className="w-full space-y-6">
      <PageTitle
        title="Voucher Diagnostics & RADIUS Logs"
        subtitle="Troubleshoot authentication, inspect server daemon logs, and review audit history"
        icon={<Terminal size={22} className="text-primary" />}
      />

      {logCheckError && (
        <div className="bg-rose-50 text-rose-800 border border-rose-200 rounded-2xl p-4 flex items-center gap-2">
          <AlertCircle size={18} className="shrink-0" />
          <span className="text-sm font-semibold">{logCheckError}</span>
        </div>
      )}

      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
            activeTab === 'diagnostics'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('diagnostics')}
        >
          <Terminal size={16} /> Voucher Diagnostics
        </button>
        <button
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
            activeTab === 'serverlog'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => setActiveTab('serverlog')}
        >
          <FileText size={16} /> RADIUS Server Log
        </button>
        {isAdmin && (
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-t-xl border-b-2 transition-all cursor-pointer ${
              activeTab === 'authlogs'
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
            onClick={() => setActiveTab('authlogs')}
          >
            <ShieldCheck size={16} /> Authentication Logs
          </button>
        )}
      </div>

      {/* Tab 1: Voucher Diagnostics */}
      {activeTab === 'diagnostics' && (
        <GlassCard className="space-y-6 p-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700 block">Enter Voucher Code to Diagnose</label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                className="input text-base"
                placeholder="e.g. ASMRWRHR"
                value={diagCode}
                onChange={(e) => setDiagCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runDiagnostics()}
              />
              <input
                className="input text-base font-mono uppercase sm:max-w-[16rem]"
                placeholder="Device MAC (optional)"
                value={diagMac}
                onChange={(e) => setDiagMac(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && runDiagnostics()}
              />
              <button
                className="btn-primary px-6 flex items-center gap-2 cursor-pointer"
                onClick={() => runDiagnostics()}
                disabled={diagLoading || !diagCode.trim()}
              >
                {diagLoading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Diagnosing...
                  </>
                ) : (
                  'Diagnose'
                )}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Leave the MAC blank to test the voucher against the device it is already locked to.
              Enter the customer's current MAC to check whether <em>their</em> device would get in —
              phones rotate their Wi-Fi MAC, which is the usual reason a MAC-bound card stops working.
            </p>
          </div>

          {diagError && (
            <div className="bg-rose-50 text-rose-800 border border-rose-200 rounded-2xl p-4 flex items-center gap-2">
              <AlertCircle size={18} className="shrink-0" />
              <span className="text-sm font-semibold">{diagError}</span>
            </div>
          )}

          {/* Diagnostics Output */}
          {diagResults ? (
            <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4 text-sm leading-relaxed">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 text-base">Voucher: "{diagResults.code}"</span>
                  {diagResults.username && diagResults.username !== diagResults.code && (
                    <span className="text-xs text-slate-500 font-mono">({diagResults.username})</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigateToLogWithSearch(diagResults.code)}
                    className="btn-ghost py-1 px-2.5 text-xs flex items-center gap-1.5 font-bold text-[#003164] border border-slate-200 hover:bg-white cursor-pointer"
                  >
                    <FileText size={13} /> View Full RADIUS Log <ArrowRight size={13} />
                  </button>
                  <Pill tone={statusTone(diagResults.overall_status)}>
                    {diagResults.overall_status === 'success' ? 'Active / Valid' : diagResults.overall_status === 'error' ? 'Error / Issue Found' : 'Warning'}
                  </Pill>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Database Record:</span>
                    {diagResults.db?.exists ? (
                      <span className="flex items-center gap-1 font-semibold text-emerald-600">
                        <CheckCircle size={15} /> Found ({diagResults.db.status}{diagResults.db.is_expired ? ', expired' : ''})
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 font-semibold text-rose-600">
                        <XCircle size={15} /> Missing
                      </span>
                    )}
                  </div>

                  {diagResults.db?.exists && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Plan Package:</span>
                        <span className="font-semibold text-slate-700">{diagResults.db.plan_name || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Voucher Price:</span>
                        <span className="font-semibold text-slate-700">Rs. {diagResults.db.price}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">RADIUS Credentials:</span>
                        {diagResults.radius_tables?.has_credentials ? (
                          <span className="flex items-center gap-1 font-semibold text-emerald-600">
                            <CheckCircle size={15} /> Present
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 font-semibold text-rose-600">
                            <XCircle size={15} /> Missing from radcheck
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Online Right Now:</span>
                        {diagResults.sessions?.is_online_now ? (
                          <span className="flex items-center gap-1 font-semibold text-emerald-600">
                            <Wifi size={15} /> Yes
                          </span>
                        ) : (
                          <span className="text-slate-400 font-semibold">No</span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-2 border-t md:border-t-0 md:border-l pt-3 md:pt-0 md:pl-4">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Live RADIUS Test:</span>
                    {diagResults.live_test?.ran ? (
                      diagResults.live_test.accepted ? (
                        <span className="flex items-center gap-1 font-semibold text-emerald-600">
                          <CheckCircle size={15} /> Access-Accept
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 font-semibold text-rose-600">
                          <XCircle size={15} /> Access-Reject
                        </span>
                      )
                    ) : (
                      <span className="flex items-center gap-1 font-semibold text-slate-400" title={diagResults.live_test?.skipped_reason}>
                        <HelpCircle size={15} /> Skipped
                      </span>
                    )}
                  </div>

                  {diagResults.live_test?.reply_message && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500 shrink-0">Server Reply-Message:</span>
                      <span className="font-semibold text-slate-700 text-right">"{diagResults.live_test.reply_message}"</span>
                    </div>
                  )}

                  {diagResults.log_matches?.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Server Log Matches:</span>
                      <span className="font-semibold text-slate-700">{diagResults.log_matches.length} events</span>
                    </div>
                  )}

                  {diagResults.sessions?.recent?.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Recent Sessions:</span>
                      <span className="font-semibold text-slate-700">{diagResults.sessions.recent.length} found</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostic Summary */}
              <div className="pt-4 border-t bg-white p-4 rounded-xl border border-slate-100 shadow-2xs">
                <p className="font-bold text-slate-800 text-sm mb-1.5 flex items-center gap-2">
                  <CheckCircle size={16} className="text-primary" />
                  Diagnostic Summary:
                </p>
                <p className="text-slate-700 font-semibold text-sm leading-relaxed">
                  {diagResults.summary}
                </p>
              </div>

              {/* Recent sessions detail */}
              {diagResults.sessions?.recent?.length > 0 && (
                <div className="space-y-2 mt-2">
                  <p className="font-bold text-slate-700 text-xs">Recent Connections (radacct):</p>
                  <div className="divide-y border border-slate-100 bg-white rounded-xl overflow-hidden max-h-[160px] overflow-y-auto">
                    {diagResults.sessions.recent.map((s: any, i: number) => (
                      <div key={i} className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-slate-50/50">
                        <div>
                          <p className="font-semibold text-slate-700">
                            {s.acctstarttime || '—'} {s.acctstoptime ? `→ ${s.acctstoptime}` : '(still open)'}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            NAS: {s.nasipaddress || '—'} · IP: {s.framedipaddress || '—'} · MAC: {s.callingstationid || '—'}
                          </p>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                          {((Number(s.acctinputoctets || 0) + Number(s.acctoutputoctets || 0)) / 1048576).toFixed(1)} MB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Relevant logs detail list */}
              {diagResults.log_matches?.length > 0 && (
                <div className="space-y-2 mt-2">
                  <p className="font-bold text-slate-700 text-xs">Recent Server Log Entries for this Voucher:</p>
                  <div className="divide-y border border-slate-100 bg-white rounded-xl overflow-hidden max-h-[160px] overflow-y-auto">
                    {diagResults.log_matches.slice(0, 5).map((l: any, i: number) => (
                      <div key={i} className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-slate-50/50">
                        <div className="flex gap-2 items-start">
                          {l.type === 'success' ? (
                            <ShieldCheck size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                          ) : l.type === 'reject' ? (
                            <ShieldAlert size={16} className="text-rose-500 shrink-0 mt-0.5" />
                          ) : (
                            <HelpCircle size={16} className="text-slate-400 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <p className="font-semibold text-slate-700">{l.status_message}</p>
                            {l.client && <p className="text-[10px] text-slate-400 font-mono">NAS: {l.client}</p>}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">{l.timestamp || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 italic">
              <Activity size={32} className="text-slate-300 mb-2" />
              <span>Enter a voucher code above and click Diagnose to start troubleshooting.</span>
            </div>
          )}
        </GlassCard>
      )}

      {/* Tab 2: RADIUS Server Log */}
      {activeTab === 'serverlog' && (
        <GlassCard className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-bold flex items-center gap-2"><FileText size={18} className="text-[#003164]" /> FreeRADIUS Server Log</h3>
              {serverLog?.exists && (
                <p className="text-xs text-slate-500 mt-1 font-mono truncate">
                  {serverLog.path} · {num(serverLog.total_lines || 0)} lines total
                  {serverLog.search ? ` · grep -i "${serverLog.search}" → ${num(serverLog.match_count || 0)} matches` : ''}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  value={serverLogFilterInput}
                  onChange={(e) => setServerLogFilterInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadServerLog(serverLogLimit, serverLogFilterInput.trim())}
                  placeholder="Search Voucher Code..."
                  className="pl-8 pr-7 py-2 text-xs rounded-xl border border-slate-200 bg-white w-52 focus:outline-none focus:border-slate-300"
                />
                {serverLogFilterInput && (
                  <button
                    onClick={() => {
                      setServerLogFilterInput('')
                      loadServerLog(serverLogLimit, '')
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                    title="Clear Search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <button
                onClick={() => loadServerLog(serverLogLimit, serverLogFilterInput.trim())}
                disabled={serverLogLoading}
                className="px-3 py-2 text-xs font-bold rounded-xl bg-[#003164] text-white hover:opacity-90 disabled:opacity-40 transition-all cursor-pointer"
              >
                Search Log
              </button>

              <div className="w-[160px]">
                <CustomSelect
                  value={serverLogLimit}
                  onChange={(val) => {
                    const v = Number(val)
                    setServerLogLimit(v)
                    loadServerLog(v, serverLogFilterInput.trim())
                  }}
                  options={limitOptions}
                />
              </div>

              <button
                onClick={() => loadServerLog(serverLogLimit, serverLogFilterInput.trim())}
                disabled={serverLogLoading}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all cursor-pointer"
              >
                <RefreshCw size={13} className={serverLogLoading ? 'animate-spin' : ''} /> Refresh Log
              </button>
            </div>
          </div>

          {serverLogLoading ? (
            <div className="py-12 flex justify-center"><Spinner /></div>
          ) : !serverLog?.exists ? (
            <EmptyState>
              {serverLog?.message || 'FreeRADIUS log file not found or not readable.'}
            </EmptyState>
          ) : (() => {
            const needle = serverLog.search || ''
            const rows = serverLog.logs || []
            if (!rows.length) {
              return <EmptyState>{needle ? `No log lines match "${needle}".` : 'The log file is empty.'}</EmptyState>
            }
            return (
              <div className="rounded-2xl border border-slate-200 bg-slate-900 overflow-hidden">
                <div className="max-h-[560px] overflow-auto font-mono text-[11px] leading-relaxed">
                  {rows.map((l: any, i: number) => (
                    <div
                      key={i}
                      className={`px-4 py-1.5 border-b border-slate-800/60 whitespace-pre-wrap break-all ${
                        l.type === 'reject'
                          ? 'text-rose-300 bg-rose-500/10'
                          : l.type === 'success'
                          ? 'text-emerald-300'
                          : l.type === 'system'
                          ? 'text-slate-400'
                          : 'text-sky-200'
                      }`}
                    >
                      {l.raw}
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2 bg-slate-800 text-slate-400 text-[10px] font-mono flex justify-between">
                  <span>
                    {num(rows.length)} line{rows.length === 1 ? '' : 's'} shown
                    {needle ? ` · matched "${needle}" across the whole log${serverLog.truncated ? ` (newest ${num(rows.length)} of ${num(serverLog.match_count)})` : ''}` : ''}
                  </span>
                  <span>Newest First</span>
                </div>
              </div>
            )
          })()}
        </GlassCard>
      )}

      {/* Tab 3: Authentication Logs (Admin Only) */}
      {activeTab === 'authlogs' && isAdmin && (
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
                  <p className="text-xs text-rose-600 font-bold">Failed Attempts (Last 24 Hours)</p>
                  <p className="text-xl font-black text-rose-700 mt-0.5">{num(failed24h)} failures</p>
                </div>
              </div>

              {bruteForceAlerts.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
                  <div className="p-3 bg-amber-500 text-white rounded-xl shadow-md shadow-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 font-bold">Potential Brute-Force Alert</p>
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
                value={authLogUserSearch}
                onChange={(e) => setAuthLogUserSearch(e.target.value)}
              />
            </div>
            <div className="w-[240px]">
              <CustomSelect
                value={authLogReplyFilter}
                onChange={(val) => setAuthLogReplyFilter(val)}
                options={replyOptions}
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
                  <th>Authentication Status</th>
                  <th>Attempt Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {authLogs.map((log, idx) => (
                  <motion.tr
                    key={log.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="hover:bg-secondary/30"
                  >
                    <td className="font-semibold text-slate-700">
                      <div className="flex items-center gap-2">
                        <span>{log.username}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setDiagCode(log.username)
                            setActiveTab('diagnostics')
                            runDiagnostics(log.username)
                          }}
                          className="text-[10px] text-primary font-bold hover:underline cursor-pointer"
                          title="Diagnose this user"
                        >
                          [Diagnose]
                        </button>
                      </div>
                    </td>
                    <td>
                      {isChapBlob(log.pass) ? (
                        <span
                          className="font-mono text-slate-400 bg-slate-100/50 p-1 px-2.5 rounded-lg text-[11px] font-semibold"
                          title="This login came in over CHAP, so the client only ever sent a hash — the typed password is not recoverable, and this tells you nothing about whether it was correct. Check the Server Log tab for the actual reject reason."
                        >
                          CHAP — not recoverable
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-600 bg-slate-100/50 p-1 px-2.5 rounded-lg text-xs font-semibold">
                            {revealedPasswords[log.id] ? log.pass : '••••••••'}
                          </span>
                          <button
                            onClick={() => togglePasswordReveal(log.id)}
                            className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                            title={revealedPasswords[log.id] ? 'Hide Password' : 'Show Password'}
                          >
                            {revealedPasswords[log.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`pill text-[10px] font-bold ${log.reply === 'Access-Accept' ? 'success' : 'danger'}`}>
                        {log.reply === 'Access-Accept' ? 'Accept' : 'Reject'}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500 font-medium">
                      {datet(log.authdate)}
                    </td>
                  </motion.tr>
                ))}
                {authLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-400 text-sm font-semibold">
                      {authLogLoading ? 'Loading Authentication Logs...' : 'No authentication logs found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {authLogMeta && <Pagination meta={authLogMeta} onPage={loadAuthLogs} />}
        </GlassCard>
      )}
    </div>
  )
}

