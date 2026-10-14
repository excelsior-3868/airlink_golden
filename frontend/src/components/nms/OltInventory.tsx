import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database as IcoDatabase, RefreshCw, Search } from 'lucide-react'
import { nmsApi, errMsg, Olt } from '../../lib/nmsApi'
import { ago, dateTime } from '../../lib/nmsFormat'
import SyncButton from './SyncButton'
import { Card, ErrorBox, Loading, StatusText, Table, Td, Tr, inputCls } from './NmsUi'

interface SyncRun {
  id: number
  started_at: string
  finished_at: string | null
  status: string
  triggered_by: string
  counts: Record<string, number>
  error: string
}

interface Snapshot {
  command: string
  output: string
  error: string
  collected_at: string
}

type Row = Record<string, string | number | null>

const tabs = ['service-ports', 'vlans', 'profiles', 'boards', 'raw', 'history'] as const
type Tab = (typeof tabs)[number]

const label: Record<Tab, string> = {
  'service-ports': 'Service-Ports',
  vlans: 'VLANs',
  profiles: 'Profiles',
  boards: 'Boards',
  raw: 'Raw Output',
  history: 'Sync History',
}

function Rows({ olt, kind, filter }: { olt: number; kind: string; filter: string }) {
  const q = useQuery({
    queryKey: ['inv', olt, kind],
    queryFn: async () => (await nmsApi.get<Row[]>(`/olts/${olt}/inventory/${kind}`)).data,
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox msg={errMsg(q.error)} />
  const all = q.data ?? []
  const f = filter.trim().toLowerCase()
  const rows = f ? all.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(f))) : all

  if (all.length === 0) {
    return (
      <p className="text-xs sm:text-sm text-slate-500 p-4">
        Nothing synced yet. Run a sync, and check the Raw Output tab if the OLT answered but nothing was parsed.
      </p>
    )
  }

  const cols = Object.keys(all[0])
  return (
    <>
      <p className="mb-2 text-xs font-semibold text-slate-500">
        {rows.length} Of {all.length} Rows
      </p>
      <Table head={cols.map((c) => c.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()))}>
        {rows.map((r, i) => (
          <Tr key={i}>
            {cols.map((c) => (
              <Td key={c} className="tabular-nums">
                {c.endsWith('_at') ? ago(String(r[c])) : String(r[c] ?? '-')}
              </Td>
            ))}
          </Tr>
        ))}
      </Table>
    </>
  )
}

function Raw({ olt }: { olt: number }) {
  const q = useQuery({
    queryKey: ['snap', olt],
    queryFn: async () => (await nmsApi.get<Snapshot[]>(`/olts/${olt}/snapshots`)).data,
  })
  if (q.isLoading) return <Loading />
  if (!q.data?.length) return <p className="text-xs sm:text-sm text-slate-500 p-4">No raw output stored yet.</p>

  return (
    <div className="space-y-3">
      {q.data.map((s) => (
        <details key={s.command} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
          <summary className="cursor-pointer text-xs sm:text-sm font-semibold flex items-center justify-between">
            <code className="text-primary font-mono">{s.command}</code>
            <span className="text-slate-400 text-xs">{ago(s.collected_at)}</span>
          </summary>
          {s.error && <p className="mt-2 text-xs text-rose-500">{s.error}</p>}
          <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-slate-900 text-slate-100 p-3 text-xs font-mono">
            {s.output || '(empty)'}
          </pre>
        </details>
      ))}
    </div>
  )
}

function History({ olt }: { olt: number }) {
  const q = useQuery({
    queryKey: ['syncruns', olt],
    queryFn: async () => (await nmsApi.get<SyncRun[]>(`/olts/${olt}/sync-runs`)).data,
    refetchInterval: 5_000,
  })
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox msg={errMsg(q.error)} />
  const runs = q.data ?? []
  if (runs.length === 0) return <p className="text-xs sm:text-sm text-slate-500 p-4">No sync runs recorded yet.</p>

  return (
    <Table head={['#', 'Status', 'Triggered By', 'Started', 'Finished', 'Records Extracted']}>
      {runs.map((r) => (
        <Tr key={r.id}>
          <Td className="font-bold">{r.id}</Td>
          <Td><StatusText s={r.status} /></Td>
          <Td>{r.triggered_by}</Td>
          <Td className="text-slate-400 whitespace-nowrap">{dateTime(r.started_at)}</Td>
          <Td className="text-slate-400 whitespace-nowrap">{r.finished_at ? dateTime(r.finished_at) : 'In Progress'}</Td>
          <Td className="text-xs">
            {r.counts && Object.keys(r.counts).length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {Object.entries(r.counts).map(([k, v]) => (
                  <span key={k} className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-medium">
                    {k}: {v}
                  </span>
                ))}
              </span>
            ) : (
              '-'
            )}
          </Td>
        </Tr>
      ))}
    </Table>
  )
}

export default function OltInventory({ olt }: { olt: Olt }) {
  const [tab, setTab] = useState<Tab>('service-ports')
  const [filter, setFilter] = useState('')

  return (
    <Card
      action={<SyncButton olt={olt} />}
      icon={IcoDatabase}
      title="OLT Synced Inventory"
      subtitle={`Last Synced: ${olt.last_sync_at ? ago(olt.last_sync_at) : 'Never'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t)
                setFilter('')
              }}
              className={`rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all ${
                tab === t
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {label[t]}
            </button>
          ))}
        </div>
        {['service-ports', 'vlans', 'profiles', 'boards'].includes(tab) && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter Table..."
              className={`${inputCls} pl-9`}
            />
          </div>
        )}
      </div>

      {tab === 'raw' && <Raw olt={olt.id} />}
      {tab === 'history' && <History olt={olt.id} />}
      {['service-ports', 'vlans', 'profiles', 'boards'].includes(tab) && (
        <Rows olt={olt.id} kind={tab} filter={filter} />
      )}
    </Card>
  )
}
