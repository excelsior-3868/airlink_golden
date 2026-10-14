import { ScrollText as IcoScrollText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { nmsApi } from '../../lib/nmsApi'
import { dateTime } from '../../lib/nmsFormat'
import { Loading, Table, Td, Tr, PageTitle } from '../../components/nms/NmsUi'

interface Entry {
  id: number
  ts: string
  actor: string
  action: string
  target: string
  detail: string
}

export default function NmsAudit() {
  const q = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await nmsApi.get<Entry[]>('/audit')).data,
    refetchInterval: 15_000,
  })

  if (q.isLoading) return <Loading />

  return (
    <div className="space-y-6">
      <PageTitle
        title="OLT System Audit Log"
        subtitle="Immutable audit log of provisioning operations and configuration modifications"
        icon={<IcoScrollText size={22} className="text-primary" />}
      />

      <Table
        head={['Timestamp', 'User / Actor', 'Action Executed', 'Target Resource', 'Operation Details']}
        empty={q.data?.length === 0 ? 'No Audit Log Entries Recorded.' : undefined}
      >
        {q.data?.map((e) => (
          <Tr key={e.id}>
            <Td className="whitespace-nowrap text-slate-400 font-mono text-xs">{dateTime(e.ts)}</Td>
            <Td className="font-bold text-slate-800 dark:text-slate-100">{e.actor}</Td>
            <Td>
              <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-primary font-mono">
                {e.action}
              </span>
            </Td>
            <Td className="font-semibold text-slate-700 dark:text-slate-200">{e.target}</Td>
            <Td className="break-words text-xs text-slate-600 dark:text-slate-400 max-w-lg">{e.detail}</Td>
          </Tr>
        ))}
      </Table>
    </div>
  )
}
