import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, XCircle, HelpCircle, Activity, ShieldCheck, ShieldAlert, RefreshCw, Wifi } from 'lucide-react'
import { api } from '../lib/api'
import { GlassCard, PageTitle, Pill } from '../components/ui'

export default function RadiusLogs() {
  const [logData, setLogData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Diagnostics State
  const [diagCode, setDiagCode] = useState('')
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagResults, setDiagResults] = useState<any>(null)
  const [diagError, setDiagError] = useState<string | null>(null)

  // Cheap availability check only — the actual diagnostic grep runs
  // server-side, scoped to the specific voucher, when Diagnose is clicked.
  const checkLogAvailability = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get('/radius/server-log', { params: { limit: 1 } })
      setLogData(response.data.data)
      if (response.data.data?.exists === false) {
        setError(response.data.data.message || 'FreeRADIUS log file not found or not readable.')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to reach the RADIUS log endpoint.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    checkLogAvailability()
  }, [])

  // Real diagnosis, sourced from one backend call: DB record, live radcheck/
  // radreply presence, real radacct session history, a targeted grep of the
  // FULL radius.log for this exact voucher (not just the last 500 generic
  // lines), and — when it's safe to do so without burning the voucher's
  // validity window — a live Access-Request fired at FreeRADIUS right now.
  const runDiagnostics = async () => {
    const code = diagCode.trim()
    if (!code) return
    setDiagLoading(true)
    setDiagError(null)
    setDiagResults(null)

    try {
      const response = await api.get(`/radius/diagnose/${encodeURIComponent(code)}`)
      setDiagResults(response.data.data)
    } catch (err: any) {
      setDiagError(err.response?.data?.message || err.message || 'Diagnostics request failed.')
    } finally {
      setDiagLoading(false)
    }
  }

  const statusTone = (status: string) => (status === 'success' ? 'success' : status === 'error' ? 'danger' : 'warning')

  return (
    <div className="w-full space-y-6 py-4">
      <PageTitle
        title="Voucher Diagnostics"
        subtitle="Troubleshoot authentication & authorization issues for voucher cards"
        icon={<Activity size={22} className="text-primary" />}
      />

      {error && (
        <div className="bg-rose-50 text-rose-800 border border-rose-200 rounded-2xl p-4 flex items-center gap-2">
          <AlertCircle size={18} className="shrink-0" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      )}

      <GlassCard className="space-y-6 p-6">
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-700 block">Enter Voucher Code to Diagnose</label>
          <div className="flex gap-3">
            <input
              className="input text-base"
              placeholder="e.g. ASMRWRHR"
              value={diagCode}
              onChange={(e) => setDiagCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runDiagnostics()}
            />
            <button
              className="btn-primary px-6 flex items-center gap-2"
              onClick={runDiagnostics}
              disabled={diagLoading || !diagCode.trim()}
            >
              {diagLoading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Diagnosing...
                </>
              ) : 'Diagnose'}
            </button>
          </div>
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
            <div className="flex items-center justify-between border-b pb-3">
              <span className="font-bold text-slate-800 text-base">Voucher: "{diagResults.code}"</span>
              <Pill tone={statusTone(diagResults.overall_status)}>
                {diagResults.overall_status?.toUpperCase()}
              </Pill>
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
                <div className="divide-y border border-slate-100 bg-white rounded-xl overflow-hidden max-h-[140px] overflow-y-auto">
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
    </div>
  )
}
