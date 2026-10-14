import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ListOrdered as IcoListOrdered, Phone as IcoPhone, Settings as IcoSettings,
  SlidersHorizontal as IcoSlidersHorizontal, Trash2, UserPlus, Loader2
} from 'lucide-react'
import { nmsApi, errMsg } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'
import { Card, ErrorBox, Field, Loading, SeverityBadge, Table, Td, Tr, inputCls, PageTitle } from '../../components/nms/NmsUi'

interface Rule {
  id: number
  name: string
  metric: string
  severity: string
  op: string
  threshold: number
  for_samples: number
  role_filter: string
  enabled: boolean
}

interface Contact {
  id: number
  name: string
  phone: string
  email: string
  has_push: boolean
}

interface Group {
  id: number
  name: string
  members: { id: number; name: string }[]
}

interface Policy {
  id: number
  name: string
  severity: string
  steps: { after_minutes: number; channel: string; group: string }[]
}

function RuleRow({ r, editable }: { r: Rule; editable: boolean }) {
  const qc = useQueryClient()
  const [th, setTh] = useState(String(r.threshold))
  const [n, setN] = useState(String(r.for_samples))

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      nmsApi.put(`/rules/${r.id}`, {
        threshold: Number(th),
        for_samples: Number(n),
        enabled,
        severity: r.severity,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  const dirty = th !== String(r.threshold) || n !== String(r.for_samples)

  return (
    <Tr>
      <Td className="font-bold text-slate-800 dark:text-slate-100">{r.name}</Td>
      <Td><SeverityBadge s={r.severity} /></Td>
      <Td className="text-slate-500 font-mono text-xs">{r.metric}{r.role_filter && ` (${r.role_filter})`}</Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <span className="font-mono">{r.op}</span>
          <input
            aria-label="Threshold"
            className={`${inputCls} !w-24 text-center tabular-nums`}
            value={th}
            disabled={!editable}
            onChange={(e) => setTh(e.target.value)}
          />
        </div>
      </Td>
      <Td>
        <input
          aria-label="Sustained polls"
          className={`${inputCls} !w-20 text-center tabular-nums`}
          value={n}
          disabled={!editable}
          onChange={(e) => setN(e.target.value)}
        />
      </Td>
      <Td>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            aria-label="Enabled"
            className="h-4 w-4 rounded accent-primary cursor-pointer"
            checked={r.enabled}
            disabled={!editable}
            onChange={(e) => save.mutate(e.target.checked)}
          />
          {dirty && (
            <button
              type="button"
              className="btn-primary py-1 px-3 rounded-lg text-xs font-bold"
              onClick={() => save.mutate(r.enabled)}
              disabled={save.isPending}
            >
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </button>
          )}
        </div>
      </Td>
    </Tr>
  )
}

export default function NmsAlertingSettings() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [err, setErr] = useState('')

  const rules = useQuery({ queryKey: ['rules'], queryFn: async () => (await nmsApi.get<Rule[]>('/rules')).data })
  const contacts = useQuery({ queryKey: ['contacts'], queryFn: async () => (await nmsApi.get<Contact[]>('/contacts')).data })
  const groups = useQuery({ queryKey: ['groups'], queryFn: async () => (await nmsApi.get<Group[]>('/contact-groups')).data })
  const policies = useQuery({ queryKey: ['policies'], queryFn: async () => (await nmsApi.get<Policy[]>('/escalation-policies')).data })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contacts'] })
    qc.invalidateQueries({ queryKey: ['groups'] })
  }

  const onErr = (e: unknown) => setErr(errMsg(e))
  const addContact = useMutation({ mutationFn: (b: object) => nmsApi.post('/contacts', b), onSuccess: refresh, onError: onErr })
  const delContact = useMutation({ mutationFn: (id: number) => nmsApi.delete(`/contacts/${id}`), onSuccess: refresh, onError: onErr })

  const member = useMutation({
    mutationFn: ({ g, c, add }: { g: number; c: number; add: boolean }) =>
      add ? nmsApi.put(`/contact-groups/${g}/members/${c}`) : nmsApi.delete(`/contact-groups/${g}/members/${c}`),
    onSuccess: refresh,
    onError: onErr,
  })

  if (rules.isLoading || !contacts.data || !groups.data || !policies.data) return <Loading />

  return (
    <div className="space-y-6">
      <PageTitle
        title="Alerting & Escalation Settings"
        subtitle="Escalation policies, alert threshold rules, and on-call notification contacts"
        icon={<IcoSettings size={22} className="text-primary" />}
      />

      {err && <ErrorBox msg={err} />}

      <Card
        icon={IcoListOrdered}
        title="Escalation Policies"
        subtitle="Automated paging schedule and notification channels per severity"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {policies.data.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/40">
              <div className="mb-3 flex items-center gap-2">
                <SeverityBadge s={p.severity} />
                <span className="font-bold text-slate-800 dark:text-slate-100">{p.name}</span>
              </div>
              <ol className="space-y-2 text-xs sm:text-sm">
                {p.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="tabular-nums font-bold text-primary">After {s.after_minutes} Min:</span>
                    <span className="uppercase font-semibold text-xs rounded bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5">{s.channel}</span> to {s.group}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-slate-400">Acknowledging an active incident stops the escalation timer immediately.</p>
            </div>
          ))}
        </div>
      </Card>

      <Card
        icon={IcoSlidersHorizontal}
        tone="warning"
        title="Alert Threshold Rules"
        subtitle="Conditions under which telemetry anomalies trigger open incidents"
      >
        <p className="mb-4 text-xs sm:text-sm text-slate-500">
          A rule triggers an incident only after the threshold condition persists for the specified number of consecutive poll cycles.
        </p>
        <Table head={['Rule Name', 'Severity Level', 'Telemetry Metric', 'Comparison Threshold', 'Sustained Polls', 'Status & Actions']}>
          {rules.data?.map((r) => (
            <RuleRow key={`${r.id}-${r.threshold}-${r.for_samples}`} r={r} editable={isAdmin} />
          ))}
        </Table>
      </Card>

      <Card
        icon={IcoPhone}
        tone="success"
        title="On-Call Notification Contacts"
        subtitle="Engineers and groups receiving incident dispatches"
      >
        <Table head={['Engineer Name', 'Phone Number', 'Email Address', 'Push Notifications', ...groups.data.map((g) => g.name), 'Actions']}>
          {contacts.data.map((c) => (
            <Tr key={c.id}>
              <Td className="font-bold text-slate-800 dark:text-slate-100">{c.name}</Td>
              <Td className="font-mono text-xs">{c.phone || '-'}</Td>
              <Td className="text-xs">{c.email || '-'}</Td>
              <Td>{c.has_push ? <span className="text-emerald-500 font-bold">Active</span> : <span className="text-slate-400">No</span>}</Td>
              {groups.data.map((g) => {
                const on = g.members.some((m) => m.id === c.id)
                return (
                  <Td key={g.id}>
                    <input
                      type="checkbox"
                      aria-label={`${c.name} in ${g.name}`}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                      checked={on}
                      disabled={!isAdmin}
                      onChange={(e) => member.mutate({ g: g.id, c: c.id, add: e.target.checked })}
                    />
                  </Td>
                )
              })}
              <Td>
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={`Delete ${c.name}`}
                    className="text-rose-500 hover:text-rose-700 p-1"
                    onClick={() => delContact.mutate(c.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </Td>
            </Tr>
          ))}
        </Table>

        {isAdmin && (
          <form
            className="mt-6 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              addContact.mutate({
                name: f.get('name'),
                phone: f.get('phone'),
                email: f.get('email'),
                push_token: f.get('push'),
              })
              e.currentTarget.reset()
            }}
          >
            <Field label="Full Name">
              <input name="name" className={inputCls} placeholder="John Doe" required />
            </Field>
            <Field label="Phone (SMS/Voice)">
              <input name="phone" className={inputCls} placeholder="+9779800000000" />
            </Field>
            <Field label="Email Address">
              <input name="email" type="email" className={inputCls} placeholder="engineer@domain.com" />
            </Field>
            <div>
              <button
                type="submit"
                className="btn-primary py-2 px-5 rounded-xl font-bold flex items-center gap-2 text-sm w-full justify-center disabled:opacity-50"
                disabled={addContact.isPending}
              >
                {addContact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Add Contact
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
