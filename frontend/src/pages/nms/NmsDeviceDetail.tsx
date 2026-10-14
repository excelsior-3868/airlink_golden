import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ArrowLeft, Cable as IcoCable, HeartPulse as IcoHeartPulse, Info as IcoInfo, Network as IcoNetwork, Server as IcoServer, Edit2 } from 'lucide-react'
import { nmsApi, Device, Iface, Olt } from '../../lib/nmsApi'
import { OltDetail, OltSection } from '../../components/nms/OltPanel'
import { useAuth } from '../../lib/auth'
import { bps, dateTime, duration } from '../../lib/nmsFormat'
import { CustomSelect } from '../../components/ui'
import { Card, ErrorBox, Loading, StatusText, Table, Td, Tr, UtilBar, PageTitle } from '../../components/nms/NmsUi'
import EditDeviceModal from '../../components/nms/EditDeviceModal'

interface Point {
  ts: string
  value: number
}

function Sparkline({ points, label, unit }: { points: Point[]; label: string; unit: (v: number) => string }) {
  if (points.length < 2) {
    return <p className="text-xs sm:text-sm text-slate-500 py-6 text-center">Not enough metrics samples recorded for {label} yet.</p>
  }
  const w = 600
  const h = 120
  const vals = points.map((p) => p.value)
  const max = Math.max(...vals, 1)
  const t0 = new Date(points[0].ts).getTime()
  const t1 = new Date(points[points.length - 1].ts).getTime()
  const x = (t: string) => ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * w
  const y = (v: number) => h - (v / max) * (h - 8) - 4
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')

  return (
    <figure className="space-y-1">
      <figcaption className="flex justify-between text-xs sm:text-sm">
        <span className="font-bold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="text-slate-400 font-semibold tabular-nums">Peak {unit(max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full text-primary" role="img" aria-label={`${label} over time`}>
        <path d={`${d} L${w},${h} L0,${h} Z`} fill="currentColor" opacity="0.12" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  )
}

export default function NmsDeviceDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const goBack = () => (window.history.length > 1 ? nav(-1) : nav('/nms/devices'))
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [hours, setHours] = useState('6')
  const [tab, setTab] = useState('overview')
  const [editing, setEditing] = useState(false)

  const dev = useQuery({
    queryKey: ['device', id],
    queryFn: async () => (await nmsApi.get<Device>(`/devices/${id}`)).data,
    refetchInterval: 15_000,
  })

  const ifs = useQuery({
    queryKey: ['ifaces', id],
    queryFn: async () => (await nmsApi.get<Iface[]>(`/devices/${id}/interfaces`)).data,
    refetchInterval: 15_000,
  })

  const cpu = useQuery({
    queryKey: ['m', id, 'cpu', hours],
    queryFn: async () => (await nmsApi.get<Point[]>(`/devices/${id}/metrics?name=cpu_pct&hours=${hours}`)).data,
  })

  const mem = useQuery({
    queryKey: ['m', id, 'mem', hours],
    queryFn: async () => (await nmsApi.get<Point[]>(`/devices/${id}/metrics?name=mem_pct&hours=${hours}`)).data,
  })

  const toggle = useMutation({
    mutationFn: ({ i, monitored }: { i: number; monitored: boolean }) =>
      nmsApi.patch(`/interfaces/${i}`, { monitored }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ifaces', id] }),
  })

  const isOlt = dev.data?.role === 'olt'
  const olts = useQuery({
    queryKey: ['olts'],
    enabled: isOlt,
    queryFn: async () => (await nmsApi.get<Olt[]>('/olts')).data,
    refetchInterval: 30_000,
  })
  const olt = olts.data?.find((o) => String(o.id) === id)

  const tabs: { key: string; label: string }[] = [
    { key: 'overview', label: 'Device Identity & Polling' },
    ...(isOlt
      ? [
          { key: 'login', label: 'Connection & Login' },
          { key: 'autofind', label: 'Unregistered ONTs (Autofind)' },
          { key: 'inventory', label: 'OLT Synced Inventory' },
          { key: 'onts', label: 'Registered ONTs' },
        ]
      : []),
  ]

  if (dev.isLoading) return <Loading />
  if (!dev.data) return <ErrorBox msg="Device Not Found." />
  const d = dev.data

  return (
    <div className="space-y-6">
      <PageTitle
        title={d.name}
        subtitle={`${d.role.toUpperCase()} • ${d.ip}${d.vendor ? ` • ${d.vendor}` : ''}`}
        icon={<IcoServer size={22} className="text-primary" />}
        action={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shadow-xs">
              <StatusText s={d.status} />
              <span className="text-xs text-muted-foreground">Since {dateTime(d.status_since)}</span>
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              className="btn-secondary py-2 px-3.5 rounded-xl font-bold flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
              onClick={goBack}
            >
              <ArrowLeft size={16} /> Back To OLTs
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              className="btn-primary py-2 px-3.5 rounded-xl font-bold flex items-center gap-1.5 text-xs sm:text-sm shadow-sm"
              onClick={() => setEditing(true)}
            >
              <Edit2 size={15} /> Edit OLT
            </motion.button>
          </div>
        }
      />

      {isOlt && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-xl px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all ${
                tab === t.key
                  ? 'bg-primary text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {(!isOlt || tab === 'overview') && (<>
      <Card icon={IcoInfo} title="Device Identity & Polling Configuration" subtitle="Hardware specifications and SNMP telemetry parameters">
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs sm:text-sm">
          <div><dt className="text-slate-400 font-medium">Management IP</dt><dd className="font-mono font-bold mt-0.5">{d.ip}</dd></div>
          <div><dt className="text-slate-400 font-medium">Device Role</dt><dd className="font-semibold capitalize mt-0.5">{d.role}</dd></div>
          <div><dt className="text-slate-400 font-medium">Hardware Vendor</dt><dd className="font-semibold mt-0.5">{d.vendor || '-'}</dd></div>
          <div><dt className="text-slate-400 font-medium">Service VLAN</dt><dd className="font-semibold mt-0.5">{d.vlan ?? '-'}</dd></div>
          <div><dt className="text-slate-400 font-medium">GEM Port Index</dt><dd className="font-semibold mt-0.5">{d.gem_port ?? '-'}</dd></div>
          <div><dt className="text-slate-400 font-medium">Polling Method</dt><dd className="font-semibold uppercase mt-0.5">{d.poll_method}</dd></div>
          <div><dt className="text-slate-400 font-medium">System Uptime</dt><dd className="font-semibold mt-0.5">{duration(d.uptime_seconds)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-400 font-medium">System Description</dt><dd className="font-mono text-xs break-words text-slate-600 dark:text-slate-300 mt-0.5">{d.sys_descr || '-'}</dd></div>
        </dl>
      </Card>

      </>)}

      {isOlt && tab !== 'overview' && (
        olt ? (
          <OltDetail olt={olt} section={tab as OltSection} />
        ) : olts.isLoading ? (
          <Loading />
        ) : (
          <Card icon={IcoCable} tone="warning" title="Optical Line Terminal (OLT)" subtitle="Not yet provisioned as an active OLT">
            <p className="text-xs sm:text-sm text-slate-500">This device is designated with the OLT role but has not been initialized in the OLT management catalog.</p>
          </Card>
        )
      )}

      {(!isOlt || tab === 'overview') && (<>
      <Card
        icon={IcoHeartPulse}
        tone="success"
        title="Hardware Health Telemetry"
        subtitle="CPU utilization and memory consumption trends"
        action={
          <div className="w-36">
            <CustomSelect
              value={hours}
              onChange={setHours}
              options={[
                { value: '1', label: 'Past 1 Hour' },
                { value: '6', label: 'Past 6 Hours' },
                { value: '24', label: 'Past 24 Hours' },
                { value: '168', label: 'Past 7 Days' },
              ]}
            />
          </div>
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Sparkline points={cpu.data ?? []} label="CPU Core Utilization" unit={(v) => `${v.toFixed(0)}%`} />
          <Sparkline points={mem.data ?? []} label="Memory Allocation" unit={(v) => `${v.toFixed(0)}%`} />
        </div>
      </Card>

      <Card icon={IcoNetwork} title="Physical & Logical Interfaces" subtitle="Select critical uplinks and backhaul links to enable alerting">
        <p className="mb-4 text-xs sm:text-sm text-slate-500">
          Only monitored interfaces trigger utilization spikes and link failure incidents. Enable monitoring on backhaul uplinks, not customer ports.
        </p>
        <Table
          head={['Monitored', 'Interface Name', 'Interface Alias', 'Operational State', 'Link Speed', 'Inbound Traffic', 'Outbound Traffic', 'Utilization', 'Error Packets']}
          empty={ifs.data?.length === 0 ? 'No Interfaces Discovered Via SNMP.' : undefined}
        >
          {ifs.data?.map((i) => (
            <Tr key={i.id}>
              <Td>
                <input
                  type="checkbox"
                  aria-label={`Monitor ${i.name}`}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                  checked={i.monitored}
                  disabled={!isAdmin}
                  onChange={(e) => toggle.mutate({ i: i.id, monitored: e.target.checked })}
                />
              </Td>
              <Td className="font-bold text-slate-800 dark:text-slate-100">{i.name}</Td>
              <Td className="text-slate-500 font-mono text-xs">{i.alias || '-'}</Td>
              <Td><StatusText s={i.oper_status} /></Td>
              <Td className="tabular-nums font-semibold">{bps(i.speed_bps)}</Td>
              <Td className="tabular-nums font-semibold">{bps(i.in_bps)}</Td>
              <Td className="tabular-nums font-semibold">{bps(i.out_bps)}</Td>
              <Td><UtilBar v={i.util_pct} /></Td>
              <Td className="tabular-nums text-xs font-semibold text-rose-500">{i.in_errors + i.out_errors}</Td>
            </Tr>
          ))}
        </Table>
      </Card>
      </>)}

      {editing && d && (
        <EditDeviceModal
          device={d}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
