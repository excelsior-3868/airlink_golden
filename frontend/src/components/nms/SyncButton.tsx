import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Loader2 } from 'lucide-react'
import { nmsApi, errMsg, Olt } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'

interface SyncRun {
  id: number
  status: string
  error: string
  started_at: string
  finished_at: string | null
}

export default function SyncButton({ olt }: { olt: Olt }) {
  const { user } = useAuth()
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'reseller'
  const qc = useQueryClient()
  const runs = useQuery({
    queryKey: ['syncruns', olt.id],
    queryFn: async () => (await nmsApi.get<SyncRun[]>(`/olts/${olt.id}/sync-runs`)).data,
    refetchInterval: 4_000,
  })
  const latest = runs.data?.[0]
  const running = latest?.status === 'running'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [running])

  const secs = running && latest ? Math.max(0, Math.round((now - new Date(latest.started_at).getTime()) / 1000)) : 0
  const startedId = useRef<number | null>(null)

  const sync = useMutation({
    mutationFn: async () => (await nmsApi.post<SyncRun>(`/olts/${olt.id}/sync`)).data,
    onSuccess: (run) => {
      startedId.current = run.id
      qc.invalidateQueries({ queryKey: ['syncruns', olt.id] })
    },
  })

  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) {
      for (const k of ['onts', 'olts', 'inv', 'snap']) qc.invalidateQueries({ queryKey: [k] })
    }
    wasRunning.current = running
  }, [running, qc])

  if (!isOperatorOrAdmin || !olt.host_key_pinned) return null
  const failure = sync.error ? errMsg(sync.error) : latest?.status === 'failed' ? latest.error : ''
  return (
    <div className="flex flex-col items-end gap-1">
    <button
      type="button"
      className="btn-primary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-xs sm:text-sm"
      onClick={() => sync.mutate()}
      disabled={sync.isPending || running}
      title="Reads complete OLT inventory (display commands)"
    >
      {sync.isPending || running ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      {running ? `Syncing Telemetry (${secs}s)` : 'Sync From OLT'}
    </button>
    {failure && <p className="max-w-xs text-right text-xs font-semibold text-rose-600 dark:text-rose-400">{failure}</p>}
    </div>
  )
}
