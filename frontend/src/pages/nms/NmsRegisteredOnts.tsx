import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Copy, RefreshCw, Search, ListChecks as IcoListChecks, Loader2,
  ArrowRight, Radio, CheckCircle2, AlertCircle, Filter, Users, Edit2, X
} from 'lucide-react'
import { nmsApi, errMsg, Olt, Ont } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'
import { ago } from '../../lib/nmsFormat'
import { CustomSelect, StatCard } from '../../components/ui'
import SyncButton from '../../components/nms/SyncButton'
import { Card, ErrorBox, Field, Loading, StatusText, Table, Td, Tr, inputCls, PageTitle } from '../../components/nms/NmsUi'

const PAGE_SIZE = 50

interface Svc {
  spIndex?: number
  vlan: number
  gem?: number
  up: boolean
}

const keyOf = (o: { frame?: number; slot?: number; pon_port?: number; port?: number; ont_id?: number }) =>
  `${o.frame ?? 0}/${o.slot ?? 0}/${o.pon_port ?? o.port ?? 0}/${o.ont_id ?? 0}`

function VlanChips({ list, onSelectVlan }: { list?: Svc[]; onSelectVlan?: (vlan: number) => void }) {
  if (!list || list.length === 0) return <span className="text-slate-400 font-mono text-xs">-</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {list.map((x, idx) => (
        <span
          key={`${x.spIndex ?? ''}-${x.vlan}-${idx}`}
          title={
            x.spIndex != null
              ? `Service-Port #${x.spIndex} | VLAN ${x.vlan} (GEM ${x.gem ?? '-'}): ${x.up ? 'Active (Up)' : 'Inactive (Down)'}`
              : `VLAN ${x.vlan}: ${x.up ? 'Active (Up)' : 'Inactive (Down)'}`
          }
          onClick={onSelectVlan ? () => onSelectVlan(x.vlan) : undefined}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs font-bold transition-all ${
            onSelectVlan ? 'cursor-pointer hover:scale-105 active:scale-95' : ''
          } ${
            x.up
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/50'
              : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/50'
          }`}
        >
          {x.spIndex != null && <span className="opacity-70 text-[10px]">#{x.spIndex}</span>}
          <span>{x.vlan}</span>
        </span>
      ))}
    </span>
  )
}

function ReassignResellerModal({
  ont,
  oltId,
  onClose,
  onSuccess,
}: {
  ont: Ont
  oltId: number
  onClose: () => void
  onSuccess: () => void
}) {
  const [selectedReseller, setSelectedReseller] = useState<string>(
    ont.reseller_id ? String(ont.reseller_id) : ''
  )
  const [err, setErr] = useState('')

  const resellersQuery = useQuery({
    queryKey: ['olt-resellers', oltId],
    queryFn: async () =>
      (await nmsApi.get<{ id: number; username: string; name: string }[]>(`/olts/${oltId}/resellers`)).data,
  })

  const reassign = useMutation({
    mutationFn: async () => {
      const rid = selectedReseller ? Number(selectedReseller) : null
      return (await nmsApi.patch(`/olts/${oltId}/onts/${ont.id}/reseller`, { reseller_id: rid })).data
    },
    onSuccess: () => {
      onSuccess()
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4 bg-slate-50/50 dark:bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Users size={18} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
                Reassign Reseller
              </h2>
              <p className="text-xs text-slate-500 font-mono">{ont.serial_number}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {err && <ErrorBox msg={err} />}

          <Field label="Designated Reseller">
            <CustomSelect
              value={selectedReseller}
              onChange={setSelectedReseller}
              options={[
                { value: '', label: 'Unassigned (Admin Direct)' },
                ...(resellersQuery.data ?? []).map((r) => ({
                  value: String(r.id),
                  label: `${r.name || r.username} (@${r.username})`,
                })),
              ]}
            />
          </Field>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary py-2 px-4 rounded-xl font-bold text-xs sm:text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reassign.isPending}
              onClick={() => reassign.mutate()}
              className="btn-primary py-2 px-5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2"
            >
              {reassign.isPending && <Loader2 size={16} className="animate-spin" />}
              Save Assignment
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function OntList({ olt }: { olt: Olt }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'reseller'
  const onts = useQuery({
    queryKey: ['onts', olt.id],
    queryFn: async () => (await nmsApi.get<Ont[]>(`/olts/${olt.id}/onts`)).data,
    refetchInterval: 30_000,
  })

  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [pon, setPon] = useState('')
  const [vlanFilter, setVlanFilter] = useState('')
  const [resellerFilter, setResellerFilter] = useState('')
  const [page, setPage] = useState(1)
  const [copied, setCopied] = useState<string | null>(null)
  const [reassigningOnt, setReassigningOnt] = useState<Ont | null>(null)

  const copy = (sn: string) => {
    navigator.clipboard.writeText(sn)
    setCopied(sn)
    window.setTimeout(() => setCopied(null), 1500)
  }

  const ports = useQuery({
    queryKey: ['inv', olt.id, 'service-ports'],
    queryFn: async () => (await nmsApi.get<Record<string, unknown>[]>(`/olts/${olt.id}/inventory/service-ports`)).data,
    refetchInterval: 30_000,
  })

  const svcsByOnt = useMemo(() => {
    const map = new Map<string, Svc[]>()
    for (const r of (ports.data ?? []) as Record<string, unknown>[]) {
      const frame = Number(r.frame ?? 0)
      const slot = Number(r.slot ?? 0)
      const port = Number(r.port ?? r.pon_port ?? 0)
      const ontId = Number(r.ont_id ?? 0)
      const k = `${frame}/${slot}/${port}/${ontId}`
      const vlan = Number((r as any).vlan ?? (r as any).vlan_id)
      const spIndex = (r as any).sp_index != null ? Number((r as any).sp_index) : undefined
      const gem = (r as any).gem != null ? Number((r as any).gem) : undefined
      const up = String(r.state ?? '').toLowerCase() === 'up'
      if (!vlan || Number.isNaN(vlan)) continue

      const list = map.get(k) ?? []
      const existing = list.find((s) => s.vlan === vlan && (spIndex == null || s.spIndex === spIndex))
      if (existing) {
        if (up) existing.up = true
        if (existing.spIndex == null && spIndex != null) existing.spIndex = spIndex
        if (existing.gem == null && gem != null) existing.gem = gem
      } else {
        list.push({ spIndex, vlan, gem, up })
      }
      map.set(k, list)
    }
    return map
  }, [ports.data])

  const all = onts.data ?? []
  const ponPorts = useMemo(() => Array.from(new Set(all.map((o) => `${o.frame}/${o.slot}/${o.pon_port}`))).sort(), [all])

  const resellersList = useMemo(() => {
    const map = new Map<number, string>()
    for (const o of all) {
      if (o.reseller_id) {
        map.set(o.reseller_id, o.reseller_name || o.reseller_username || `Reseller #${o.reseller_id}`)
      }
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
  }, [all])

  const allVlans = useMemo(() => {
    const s = new Set<number>()
    for (const svcs of svcsByOnt.values()) {
      for (const svc of svcs) {
        if (svc.vlan) s.add(svc.vlan)
      }
    }
    return Array.from(s).sort((a, b) => a - b)
  }, [svcsByOnt])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((o) => {
      const svcs = svcsByOnt.get(keyOf(o)) ?? []
      if (needle) {
        const text = `${o.serial_number} ${o.description || ''} ${o.reseller_name || ''} ${o.reseller_username || ''}`.toLowerCase()
        const matchesText = text.includes(needle)
        const matchesVlan = svcs.some((s) => String(s.vlan).includes(needle))
        if (!matchesText && !matchesVlan) return false
      }
      if (state && o.run_state !== state) return false
      if (pon && `${o.frame}/${o.slot}/${o.pon_port}` !== pon) return false
      if (vlanFilter && !svcs.some((s) => String(s.vlan) === vlanFilter)) return false
      if (isAdmin && resellerFilter) {
        if (resellerFilter === 'unassigned') {
          if (o.reseller_id) return false
        } else if (String(o.reseller_id) !== resellerFilter) {
          return false
        }
      }
      return true
    })
  }, [all, q, state, pon, vlanFilter, resellerFilter, svcsByOnt, isAdmin])

  useEffect(() => setPage(1), [q, state, pon, vlanFilter, resellerFilter])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const onlineCount = all.filter((o) => o.run_state === 'online').length

  const tableHead = isAdmin
    ? ['Serial Number', 'Position (F/S/P/ONT-ID)', 'Reseller', 'Operational State', 'Active Service-Ports (VLAN)', 'Optical Rx Power', 'Last Seen Online', 'Quick Actions']
    : ['Serial Number', 'Position (F/S/P/ONT-ID)', 'Operational State', 'Active Service-Ports (VLAN)', 'Optical Rx Power', 'Last Seen Online', 'Quick Actions']

  return (
    <div className="space-y-4">
      {reassigningOnt && (
        <ReassignResellerModal
          ont={reassigningOnt}
          oltId={olt.id}
          onClose={() => setReassigningOnt(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['onts', olt.id] })
            qc.invalidateQueries({ queryKey: ['olts'] })
          }}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Registered ONTs"
          value={all.length.toLocaleString()}
          valueColorClass="text-blue-600 dark:text-blue-400"
          icon={<Radio size={20} />}
          iconColorClass="text-blue-600 bg-blue-50 dark:bg-blue-950/40"
        />
        <StatCard
          label="Online Subscribers"
          value={onlineCount.toLocaleString()}
          valueColorClass="text-emerald-600 dark:text-emerald-400"
          icon={<CheckCircle2 size={20} />}
          iconColorClass="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
        />
        <StatCard
          label="Offline Subscribers"
          value={(all.length - onlineCount).toLocaleString()}
          valueColorClass="text-rose-600 dark:text-rose-400"
          icon={<AlertCircle size={20} />}
          iconColorClass="text-rose-600 bg-rose-50 dark:bg-rose-950/40"
        />
        <StatCard
          label="Filtered Results"
          value={filtered.length.toLocaleString()}
          valueColorClass="text-indigo-600 dark:text-indigo-400"
          icon={<Filter size={20} />}
          iconColorClass="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64 sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Serial Number, Description, Or VLAN..."
            className={`${inputCls} pl-9 font-mono text-xs sm:text-sm`}
          />
        </div>

        <div className="w-56">
          <CustomSelect
            value={state}
            onChange={setState}
            options={[
              { value: '', label: 'All Operational States' },
              { value: 'online', label: 'Online' },
              { value: 'offline', label: 'Offline' },
              { value: 'initial', label: 'Initial' },
            ]}
          />
        </div>

        <div className="w-44">
          <CustomSelect
            value={pon}
            onChange={setPon}
            options={[
              { value: '', label: 'All PON Ports' },
              ...ponPorts.map((p) => ({ value: p, label: `PON ${p}` })),
            ]}
          />
        </div>

        <div className="w-44">
          <CustomSelect
            value={vlanFilter}
            onChange={setVlanFilter}
            options={[
              { value: '', label: 'All VLANs' },
              ...allVlans.map((v) => ({ value: String(v), label: `VLAN ${v}` })),
            ]}
          />
        </div>

        {isAdmin && (
          <div className="w-52">
            <CustomSelect
              value={resellerFilter}
              onChange={setResellerFilter}
              options={[
                { value: '', label: 'All Resellers' },
                { value: 'unassigned', label: 'Unassigned Reseller' },
                ...resellersList.map((r) => ({ value: String(r.id), label: r.label })),
              ]}
            />
          </div>
        )}
      </div>

      {onts.isLoading || ports.isLoading ? (
        <Loading />
      ) : onts.error ? (
        <ErrorBox msg={errMsg(onts.error)} />
      ) : (
        <>
          <Table
            head={tableHead}
            empty={filtered.length === 0 ? 'No Registered ONTs Match The Active Filter.' : undefined}
          >
            {slice.map((o) => {
              const svcs = svcsByOnt.get(keyOf(o))
              return (
                <Tr key={o.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100">{o.serial_number}</span>
                      <button
                        type="button"
                        onClick={() => copy(o.serial_number)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        title="Copy Serial Number"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {copied === o.serial_number && <span className="text-[10px] text-emerald-500 font-bold">Copied</span>}
                    </div>
                    {o.description && <div className="text-xs text-slate-500 truncate max-w-xs">{o.description}</div>}
                  </Td>
                  <Td className="tabular-nums font-mono text-xs">{o.frame}/{o.slot}/{o.pon_port} <span className="font-bold text-primary">#{o.ont_id}</span></Td>
                  {isAdmin && (
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {o.reseller_username ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs font-bold">
                            <Users size={12} />
                            {o.reseller_name || o.reseller_username}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-slate-400 font-mono text-xs">
                            Unassigned
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setReassigningOnt(o)}
                          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-primary transition-colors"
                          title="Reassign Reseller"
                        >
                          <Edit2 size={12} />
                        </button>
                      </div>
                    </Td>
                  )}
                  <Td><StatusText s={o.run_state} /></Td>
                  <Td><VlanChips list={svcs} onSelectVlan={(v) => setVlanFilter(String(v))} /></Td>
                  <Td className="tabular-nums font-semibold text-xs">
                    {o.rx_power_dbm != null ? `${o.rx_power_dbm.toFixed(2)} dBm` : '-'}
                  </Td>
                  <Td className="text-slate-400 whitespace-nowrap text-xs">{ago(o.last_seen_at)}</Td>
                  <Td>
                    {isOperatorOrAdmin && (
                      <Link
                        className="text-primary font-bold hover:underline text-xs flex items-center gap-1"
                        to={`/nms/provisioning?tab=existing&sn=${o.serial_number}`}
                      >
                        Add Service <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </Table>

          {pages > 1 && (
            <div className="flex items-center justify-between text-xs sm:text-sm text-slate-500 pt-2">
              <span>Page {page} Of {pages} ({filtered.length} Total Subscribers)</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary py-1.5 px-3 rounded-xl font-bold text-xs disabled:opacity-40"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary py-1.5 px-3 rounded-xl font-bold text-xs disabled:opacity-40"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function NmsRegisteredOnts() {
  const olts = useQuery({
    queryKey: ['olts'],
    queryFn: async () => (await nmsApi.get<Olt[]>('/olts')).data,
  })

  const [oltId, setOltId] = useState<string>('')
  const selectedOlt = olts.data?.find((o) => String(o.id) === (oltId || String(olts.data[0]?.id)))

  useEffect(() => {
    if (!oltId && olts.data?.[0]) {
      setOltId(String(olts.data[0].id))
    }
  }, [olts.data, oltId])

  return (
    <div className="space-y-6">
      <PageTitle
        title="Registered ONTs"
        subtitle="Subscriber optical network terminals provisioned across OLT ports"
        icon={<IcoListChecks size={22} className="text-primary" />}
        action={selectedOlt ? <SyncButton olt={selectedOlt} /> : undefined}
      />

      {olts.isLoading ? (
        <Loading />
      ) : (olts.data?.length ?? 0) === 0 ? (
        <Card title="No OLT Available">
          <p className="text-xs sm:text-sm text-slate-500">No Optical Line Terminals configured in the system.</p>
        </Card>
      ) : (
        <>
          {(olts.data?.length ?? 0) > 1 && (
            <div className="w-full sm:w-auto sm:min-w-[22rem] max-w-lg">
              <CustomSelect
                value={oltId}
                onChange={setOltId}
                options={olts.data!.map((o) => ({
                  value: String(o.id),
                  label: `${o.name} (${o.ip})`,
                }))}
              />
            </div>
          )}

          {selectedOlt && <OntList key={selectedOlt.id} olt={selectedOlt} />}
        </>
      )}
    </div>
  )
}
