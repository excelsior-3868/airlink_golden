import { Activity as IcoActivity, Bell as IcoBell, LayoutDashboard as IcoLayoutDashboard, Network as IcoNetwork, ArrowRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { nmsApi, Alert, Summary } from '../../lib/nmsApi'
import { ago, bps, duration } from '../../lib/nmsFormat'
import { Card, ErrorBox, Loading, SeverityBadge, Table, Td, Tr, UtilBar, PageTitle } from '../../components/nms/NmsUi'
import { StatCard } from '../../components/ui'

export default function NmsDashboard() {
  const s = useQuery({
    queryKey: ['summary'],
    queryFn: async () => (await nmsApi.get<Summary>('/summary')).data,
    refetchInterval: 10_000,
  })

  const a = useQuery({
    queryKey: ['alerts', 'dash'],
    queryFn: async () => (await nmsApi.get<Alert[]>('/alerts?suppressed=false')).data,
    refetchInterval: 10_000,
  })

  if (s.isLoading) return <Loading />
  if (s.error || !s.data) return <ErrorBox msg="Could Not Load Network Summary" />
  const d = s.data

  return (
    <div className="space-y-6">
      <PageTitle
        title="Network Operations Center"
        subtitle="Live status of network devices, active incidents, and monitored uplinks"
        icon={<IcoLayoutDashboard size={22} className="text-primary" />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Devices Online"
          value={`${d.devices.up} / ${d.devices.total}`}
          valueColorClass={d.devices.down ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
          sub={`${d.devices.down} Down, ${d.devices.unknown} Unknown`}
          icon={<IcoNetwork size={20} />}
          iconColorClass={d.devices.down ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'}
        />
        <StatCard
          label="Critical Incidents (P1)"
          value={d.alerts.p1}
          valueColorClass={d.alerts.p1 ? 'text-rose-600 dark:text-rose-400' : 'text-blue-600 dark:text-blue-400'}
          sub={`${d.alerts.p2} P2 Warning, ${d.alerts.p3} P3 Info`}
          icon={<IcoActivity size={20} />}
          iconColorClass={d.alerts.p1 ? 'text-rose-600 bg-rose-50 dark:bg-rose-950/40' : 'text-blue-600 bg-blue-50 dark:bg-blue-950/40'}
        />
        <StatCard
          label="Unacknowledged Alerts"
          value={d.alerts.unacknowledged}
          valueColorClass={d.alerts.unacknowledged ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}
          sub={`${d.alerts.suppressed} Suppressed By Upstream Link`}
          icon={<IcoBell size={20} />}
          iconColorClass={d.alerts.unacknowledged ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'}
        />
        <StatCard
          label="ONTs Online"
          value={`${d.onts.online} / ${d.onts.total}`}
          valueColorClass="text-indigo-600 dark:text-indigo-400"
          sub={`Mean Time To Acknowledge: ${duration(d.mtta.seconds)}`}
          icon={<IcoLayoutDashboard size={20} />}
          iconColorClass="text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card
          icon={IcoBell}
          tone="danger"
          title="Active Incidents"
          subtitle="Open alerts that require immediate operator attention"
          action={
            <Link className="text-xs sm:text-sm font-bold text-primary hover:underline flex items-center gap-1" to="/nms/alerts">
              All Incidents <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          <Table head={['Severity', 'Incident Description', 'Opened']} empty={a.data?.length === 0 ? 'No Active Incidents.' : undefined}>
            {a.data?.slice(0, 8).map((x) => (
              <Tr key={x.id}>
                <Td><SeverityBadge s={x.severity} /></Td>
                <Td className="font-semibold text-slate-800 dark:text-slate-200">{x.title}</Td>
                <Td className="whitespace-nowrap text-slate-400">{ago(x.opened_at)}</Td>
              </Tr>
            ))}
          </Table>
        </Card>

        <Card icon={IcoActivity} title="Busiest Monitored Uplinks" subtitle="Highest interface utilisation right now">
          <Table
            head={['Device & Interface', 'Inbound Rate', 'Outbound Rate', 'Utilisation']}
            empty={d.top_interfaces.length === 0 ? 'No Monitored Interfaces With Traffic Recorded.' : undefined}
          >
            {d.top_interfaces.map((i) => (
              <Tr key={i.id}>
                <Td>
                  <span className="font-bold text-slate-800 dark:text-slate-100">{i.device}</span>{' '}
                  <span className="text-slate-400 text-xs">({i.name})</span>
                </Td>
                <Td className="tabular-nums font-semibold">{bps(i.in_bps)}</Td>
                <Td className="tabular-nums font-semibold">{bps(i.out_bps)}</Td>
                <Td><UtilBar v={i.util_pct} /></Td>
              </Tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card icon={IcoNetwork} tone="success" title="Point Of Presence (POP) Status" subtitle="Monitored infrastructure per site">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {d.pops.length === 0 && <p className="text-xs sm:text-sm text-slate-500">No POP Sites Defined.</p>}
          {d.pops.map((p) => (
            <Link
              key={p.id}
              to={`/nms/devices?pop_id=${p.id}`}
              className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 transition-all hover:bg-slate-50/80 dark:hover:bg-slate-800/50 hover:shadow-sm"
            >
              <div className="font-bold text-slate-800 dark:text-slate-100">{p.name}</div>
              <div className={`text-xs sm:text-sm mt-1 font-semibold ${p.down ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {p.down ? `${p.down} Of ${p.devices} Down` : `${p.devices} Devices, All Operational`}
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}
