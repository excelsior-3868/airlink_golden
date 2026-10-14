import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell as IcoBell, History as IcoHistory, Check, CheckCheck, Loader2 } from 'lucide-react'
import { nmsApi, Alert, errMsg } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'
import { ago, dateTime } from '../../lib/nmsFormat'
import { CustomSelect } from '../../components/ui'
import { Card, ErrorBox, Loading, SeverityBadge, StatusText, Table, Td, Tr, inputCls, PageTitle } from '../../components/nms/NmsUi'

interface Notification {
  id: number
  channel: string
  recipient: string
  status: string
  error: string
  sent_at: string
}

function Notifications({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ['notif', id],
    queryFn: async () => (await nmsApi.get<Notification[]>(`/alerts/${id}/notifications`)).data,
  })
  if (q.isLoading) return <Loading />
  if (!q.data?.length) return <p className="text-xs sm:text-sm text-slate-500">No automated escalation notifications dispatched yet.</p>

  return (
    <ul className="space-y-1.5 text-xs sm:text-sm">
      {q.data.map((n) => (
        <li key={n.id} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
          <span className="text-slate-400 font-medium">{dateTime(n.sent_at)}</span>
          <span className="font-bold uppercase tracking-wide text-primary">{n.channel}</span> to <span className="font-semibold">{n.recipient}</span>
          <StatusText s={n.status === 'sent' ? 'ok' : n.status} />
          {n.error && <span className="text-rose-500 font-semibold">{n.error}</span>}
        </li>
      ))}
    </ul>
  )
}

export default function NmsAlerts() {
  const { user } = useAuth()
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'reseller'
  const qc = useQueryClient()
  const [state, setState] = useState('active')
  const [open, setOpen] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const list = useQuery({
    queryKey: ['alerts', state],
    queryFn: async () => (await nmsApi.get<Alert[]>(`/alerts?state=${state}`)).data,
    refetchInterval: 10_000,
  })

  const done = () => {
    qc.invalidateQueries({ queryKey: ['alerts'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
    setErr('')
  }

  const ack = useMutation({
    mutationFn: (id: number) => nmsApi.post(`/alerts/${id}/ack`),
    onSuccess: done,
    onError: (e) => setErr(errMsg(e)),
  })

  const resolve = useMutation({
    mutationFn: (id: number) => nmsApi.post(`/alerts/${id}/resolve`, { note }),
    onSuccess: () => {
      done()
      setNote('')
      setOpen(null)
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <div className="space-y-6">
      <PageTitle
        title="Incidents & Alerts"
        subtitle="Incidents triggered by network monitoring rules, root-cause correlation, and escalation log"
        icon={<IcoBell size={22} className="text-rose-500" />}
        action={
          <div className="w-52">
            <CustomSelect
              value={state}
              onChange={setState}
              options={[
                { value: 'active', label: 'Active Incidents' },
                { value: 'resolved', label: 'Resolved Incidents' },
                { value: 'all', label: 'All Incidents' },
              ]}
            />
          </div>
        }
      />

      {err && <ErrorBox msg={err} />}

      {list.isLoading ? (
        <Loading />
      ) : (
        <Table
          head={['Severity', 'Incident Summary & Root Cause', 'Current State', 'Opened Time', 'Quick Actions']}
          empty={list.data?.length === 0 ? 'No Matching Incidents Found.' : undefined}
        >
          {list.data?.map((a) => (
            <Fragment key={a.id}>
              <Tr onClick={() => setOpen(open === a.id ? null : a.id)}>
                <Td><SeverityBadge s={a.severity} /></Td>
                <Td>
                  <div className="font-bold text-slate-800 dark:text-slate-100">{a.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{a.detail}</div>
                  {a.suppressed_by && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-1">
                      Suppressed: Upstream Parent Device Down (Incident #{a.suppressed_by})
                    </div>
                  )}
                </Td>
                <Td>
                  <StatusText s={a.state} />
                  {a.acknowledged_by && (
                    <div className="text-xs text-slate-400 mt-0.5">By {a.acknowledged_by}</div>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-slate-400 font-medium">{ago(a.opened_at)}</Td>
                <Td>
                  {isOperatorOrAdmin && a.state === 'open' && (
                    <button
                      type="button"
                      className="btn-secondary py-1.5 px-3 rounded-xl font-bold flex items-center gap-1.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        ack.mutate(a.id)
                      }}
                      disabled={ack.isPending && ack.variables === a.id}
                    >
                      {ack.isPending && ack.variables === a.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Acknowledge
                    </button>
                  )}
                </Td>
              </Tr>

              {open === a.id && (
                <tr key={`${a.id}-details`} className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60">
                  <td colSpan={5} className="p-5 space-y-4">
                    <Card icon={IcoHistory} tone="warning" title="Escalation Dispatch Log" subtitle="History of notifications sent to on-call contacts">
                      <Notifications id={a.id} />
                    </Card>

                    {a.state === 'resolved' ? (
                      <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm">
                        <span className="font-bold text-slate-700 dark:text-slate-200">Resolution Note: </span>
                        <span>{a.resolution_note || 'Resolved without note.'}</span>{' '}
                        <span className="text-slate-400">({dateTime(a.resolved_at)})</span>
                      </div>
                    ) : (
                      isOperatorOrAdmin && (
                        <div className="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                          <label className="flex-1 min-w-[18rem] text-xs sm:text-sm">
                            <span className="mb-1.5 block font-bold text-slate-700 dark:text-slate-200">
                              Resolution Note (Root Cause & Corrective Action)
                            </span>
                            <input
                              className={inputCls}
                              placeholder="Describe how the problem was resolved..."
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn-primary py-2 px-5 rounded-xl font-bold flex items-center gap-2 text-sm disabled:opacity-50"
                            onClick={() => resolve.mutate(a.id)}
                            disabled={!note.trim() || resolve.isPending}
                          >
                            {resolve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                            Resolve Incident
                          </button>
                        </div>
                      )
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
      )}
    </div>
  )
}
