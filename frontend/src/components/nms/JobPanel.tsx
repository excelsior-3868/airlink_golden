import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2, CircleDashed, Pencil, Play, Save, ShieldCheck, XCircle,
  History as IcoHistory, ListOrdered as IcoListOrdered, Pencil as IcoPencil,
  Play as IcoPlay, Save as IcoSave, Loader2
} from 'lucide-react'
import { nmsApi, errMsg, Job, JobStep } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'
import { dateTime } from '../../lib/nmsFormat'
import { Card, ErrorBox, Loading, StatusText } from './NmsUi'

export const guide: Record<string, { ref: string; title: string; why: string }> = {
  check_ont_present: {
    ref: 'Workflow 0 - Step 1',
    title: 'Find The ONT By Serial Number',
    why: "Reads the ONT's port (F/S/P) and ONT-ID from the OLT itself with display ont info by-sn. The OLT is the source of truth, not this console's inventory."
  },
  check_ont_by_position: {
    ref: 'Case - Step 1 (New ONT: Part 3)',
    title: 'Verify The Registered ONT By Its Position',
    why: 'Confirms that the ONT-ID is registered on that GPON interface (display ont info F S P ID) and that its serial matches the one you entered.'
  },
  check_existing_services: {
    ref: 'Workflow 0 - Step 2 / Case - Step 2 (New ONT: Part 2, Step 2)',
    title: "Check The ONT's Existing Services",
    why: 'Lists every service-port the ONT already has, so a duplicate classification is never created and nothing existing is overwritten.'
  },
  check_line_profile_gem_mapping: {
    ref: 'Case - Step 3 (New ONT: Part 1, Step 2)',
    title: 'Check The Line-Profile GEM Mapping',
    why: 'The line profile must map the VLAN to the GEM port. Without it the service-port can come up but carry no traffic.'
  },
  check_vlan: {
    ref: 'Case - Step 4',
    title: 'Verify The VLAN Exists On The OLT',
    why: 'The service VLAN has to be configured on the OLT before a service-port can use it.'
  },
  check_vlan_uplink: {
    ref: 'Before You Begin / Case - Step 4',
    title: 'Check The VLAN Is Carried On The Uplink',
    why: 'The VLAN must be allowed on the uplink port named. A service-port on a VLAN that does not reach the uplink never passes traffic.'
  },
  check_service_port_free: {
    ref: 'Workflow 0 - Step 3',
    title: 'Find The Next Free Service-Port ID',
    why: 'The ID comes from the OLT, never from an example. It is re-checked at apply time in case another job took it.'
  },
  service_port_add: {
    ref: 'Case - Step 5',
    title: 'Create The Service-Port',
    why: 'The only step that changes the OLT. If anything after it fails, the rollback command removes just this service-port.'
  },
  verify_service_port: {
    ref: 'Case - Step 6',
    title: 'Verify The New Service-Port',
    why: 'Reads the new service-port back from the OLT. Its state should be up. An up service-port still needs a customer traffic test.'
  },
  verify_existing_services_preserved: {
    ref: 'Case - Step 6',
    title: 'Confirm Existing Services Are Untouched',
    why: "Lists the ONT's services again and compares with the before-state. Every earlier line must still be present."
  },
  check_autofind: {
    ref: 'New ONT - Part 1, Step 1',
    title: 'Find The New ONT Using Autofind',
    why: 'Lists the ONTs the OLT has detected but not registered.'
  },
  recheck_service_port_free: {
    ref: 'New ONT - Part 2, Step 3',
    title: 'Re-Check The Service-Port ID Now That The ONT Is Registered',
    why: 'Checks again after the ONT exists so the service-port never reuses an ID another job took in the meantime.'
  },
  check_ont_absent: {
    ref: 'New ONT - Part 1 (before Step 3)',
    title: 'Check The Serial Is Not Registered Yet',
    why: 'The OLT itself must confirm the serial is new.'
  },
  check_ont_id_free: {
    ref: 'New ONT - Part 1, Step 3',
    title: 'Choose A Free ONT-ID On The PON Port',
    why: 'Reads the ONT table of the PON port and takes the lowest unused ONT-ID.'
  },
  check_service_profile: {
    ref: 'New ONT - Part 1, Step 2',
    title: 'Check The Service Profile Exists',
    why: 'The service profile the ONT will be registered with must exist on this OLT.'
  },
  ont_add: {
    ref: 'New ONT - Part 1, Step 4',
    title: 'Register The ONT By Serial Number',
    why: 'Adds the ONT to the PON port with its line and service profile.'
  },
  verify_ont: {
    ref: 'New ONT - Part 1, Step 5 / Part 2, Step 1',
    title: 'Verify The ONT Registration',
    why: 'Reads the ONT back by serial and confirms it is on the chosen port with the chosen line and service profile.'
  },
  save_configuration: {
    ref: 'After Approval',
    title: 'Save The Configuration To The OLT',
    why: "Writes the OLT's running configuration to its saved configuration (the save command), so the change survives a reboot."
  },
  verify_new_service_listed: {
    ref: 'Case - Step 6',
    title: "Confirm The New Service-Port Is In The ONT's List",
    why: 'The same listing must now show the new service-port with the right VLAN.'
  },
}

export function stepTitle(s: JobStep): string {
  if (s.name === 'service_port_add') {
    return s.commands.join(' ').includes('user-vlan untagged')
      ? 'Create The Untagged Service-Port (Case 2)'
      : 'Create The Tagged Service-Port (Case 1)'
  }
  return guide[s.name]?.title ?? s.name.replace(/_/g, ' ')
}

export function spState(output: string): 'up' | 'down' | '' {
  const m = output.match(/^\s*State\s*:\s*(up|down)\b/im) ?? output.match(/\b(up|down)\s*$/im)
  return m ? (m[1].toLowerCase() as 'up' | 'down') : ''
}

export function plain(expect: string): string {
  const [name, arg = ''] = expect.split(':')
  const [a, b] = arg.split(':')
  switch (name) {
    case 'ont_present': return 'The ONT is registered on this OLT'
    case 'autofind_at': return 'The OLT detected this ONT (autofind) on the chosen PON port'
    case 'autofind_optional': return 'Autofind is informational here: you chose to register an ONT that is not connected yet'
    case 'ont_registered_at': return 'The ONT is registered on the chosen port with the chosen line and service profiles'
    case 'ont_registered_ok': return 'The ONT is registered and its configuration did not fail'
    case 'ont_absent': return 'The serial is not registered yet'
    case 'ont_healthy': return 'ONT is registered, config state normal, match state match'
    case 'ont_id_free': return `ONT-ID ${arg} is unused on the PON port`
    case 'no_vlan': return `The ONT has no service-port for VLAN ${arg} yet`
    case 'no_untagged_gem': return `The ONT has no untagged service-port on GEM port ${arg}`
    case 'ont_at': return 'An ONT is registered at this position and its serial matches'
    case 'sp_free': return `Service-port index ${arg} is unused in the OLT's table`
    case 'sp_listed': return `Service-port ${a} (VLAN ${b ?? ''}) is in the ONT's service list`
    case 'vlan_port': return `The VLAN output lists uplink port ${arg}`
    case 'vlan_has_uplink': return 'The VLAN exists and has at least one uplink port'
    case 'gem_maps': return `The line profile maps VLAN ${b ?? ''} to GEM port ${a}`
    case 'vlan_exists': return 'The VLAN exists on the OLT'
    case 'next_free': return `Service-port ID ${arg} is still the next free index`
    case 'contains': return `The OLT output shows ${arg}`
    case 'preserved': return 'Every existing service line is still present, unchanged'
    case 'absent': return 'The object no longer exists'
    default: return expect
  }
}

const kindLabel: Record<string, string> = {
  read: 'Check (Read-Only)',
  verify: 'Verify (Read-Only)',
  write: 'Change On OLT',
  rollback: 'Rollback'
}

function Evidence({ s }: { s: JobStep }) {
  if (s.kind !== 'read' || !s.plan_result) return null
  const ok = s.plan_result === 'ok'
  return (
    <div className="mt-2 text-sm">
      <div className={`flex items-center gap-1.5 font-medium ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {ok ? 'Passed when the checks were run' : s.plan_result}
      </div>
      {s.plan_output && (
        <details className="mt-1 text-xs" open={s.plan_output.split('\n').length <= 14}>
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">What The OLT Answered</summary>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 text-slate-100 p-2.5 font-mono">{s.plan_output}</pre>
        </details>
      )}
    </div>
  )
}

function Applied({ s }: { s: JobStep }) {
  if (s.result === 'pending') return null
  return (
    <div className="mt-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">When Applied:</span>
        <StatusText s={s.result.replace('rolled_back_', 'rolled back ')} />
      </div>
      {s.output && (
        <details className="mt-1 text-xs" open={s.result === 'failed'}>
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">What The OLT Answered When Applied</summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded-xl bg-slate-900 text-slate-100 p-2.5 font-mono">{s.output}</pre>
        </details>
      )}
    </div>
  )
}

function StepCard({ s, n }: { s: JobStep; n: number }) {
  const g = guide[s.name]
  const write = s.kind === 'write'
  const state = s.name === 'verify_service_port' ? spState(s.output) : ''
  return (
    <li className={`rounded-xl border p-4 transition-all ${write ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/30 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{n}</span>
        <span className="font-bold text-slate-800 dark:text-slate-100">{stepTitle(s)}</span>
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase ${write ? 'bg-amber-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
          {kindLabel[s.kind] ?? s.kind}
        </span>
        {g && <span className="text-xs text-slate-500">Guide: {g.ref}</span>}
      </div>
      {g && <p className="mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300">{g.why}</p>}
      {s.expect && (
        <p className="mt-1.5 text-xs sm:text-sm">
          <span className="text-slate-500">Must Be True:</span> {plain(s.expect)}
        </p>
      )}
      <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 text-slate-100 p-2.5 font-mono text-xs">{s.commands.join('\n')}</pre>
      {s.rollback_commands && s.rollback_commands.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-slate-500">Rollback If A Later Step Fails:</span>
          <pre className="mt-1 overflow-x-auto rounded-xl bg-slate-900 text-slate-100 p-2 font-mono">{s.rollback_commands.join('\n')}</pre>
        </div>
      )}
      <Evidence s={s} />
      <Applied s={s} />
      {state && (
        <p className={`mt-2 text-sm font-bold ${state === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          Service-Port State: {state.toUpperCase()}{state === 'down' ? ' - See the troubleshooting notes below' : ''}
        </p>
      )}
    </li>
  )
}

export function Troubleshooting({ open }: { open?: boolean }) {
  return (
    <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-sm bg-white dark:bg-slate-900" open={open}>
      <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-100">Troubleshooting Notes (From Field Guide)</summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-slate-600 dark:text-slate-300 text-xs sm:text-sm">
        <li>If the service-port command fails, inspect the exact CLI error in the failed step and confirm parameter order.</li>
        <li>If the service-port stays <b>down</b>, verify the ONT state, GEM mapping, VLAN configuration, and optical power.</li>
        <li>If the VLAN is not mapped to the chosen GEM port, add the mapping on the OLT first.</li>
        <li>Preserve existing services unless a replace operation was requested explicitly.</li>
      </ul>
    </details>
  )
}

export function useJob(id: string | number) {
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const q = useQuery({
    queryKey: ['job', String(id)],
    queryFn: async () => (await nmsApi.get<Job>(`/jobs/${id}`)).data,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2_000 : 10_000),
  })
  const act = (path: string) =>
    useMutation({
      mutationFn: () => nmsApi.post(`/jobs/${id}/${path}`),
      onSuccess: () => {
        setErr('')
        qc.invalidateQueries({ queryKey: ['job', String(id)] })
        qc.invalidateQueries({ queryKey: ['jobs'] })
      },
      onError: (e) => setErr(errMsg(e)),
    })
  const approve = act('approve')
  const apply = act('apply')
  const reject = act('reject')
  const save = act('save')
  return { q, err, approve, apply, reject, save }
}

export type JobHandle = ReturnType<typeof useJob>

export function ChangeCard({ j, title = 'What This Job Will Change On The OLT' }: { j: Job; title?: string }) {
  const writes = (j.steps ?? []).filter((s) => s.kind === 'write' && s.name !== 'save_configuration')
  if (writes.length === 0) return null
  return (
    <Card icon={IcoPencil} tone="warning" title={title} subtitle="Nothing else is sent to the OLT">
      <p className="mb-2 text-xs sm:text-sm text-slate-500">Running the checks sent nothing that changes the OLT. Applying sends only this:</p>
      {writes.map((w) => (
        <div key={w.seq} className="mb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Pencil className="h-4 w-4 text-amber-500" /> {stepTitle(w)}
          </div>
          <pre className="mt-1 overflow-x-auto rounded-xl border border-amber-300 dark:border-amber-700 bg-slate-900 text-amber-400 p-2.5 font-mono text-xs font-semibold">
            {w.commands.join('\n')}
          </pre>
          {w.rollback_commands && w.rollback_commands.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">Undo: <code className="font-mono text-slate-700 dark:text-slate-300">{w.rollback_commands.join(' ; ')}</code></p>
          )}
        </div>
      ))}
    </Card>
  )
}

export function ChecksList({ j }: { j: Job }) {
  const checks = (j.steps ?? []).filter((s) => s.kind === 'read' && s.plan_result)
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      {checks.map((s) => {
        const ok = s.plan_result === 'ok'
        return (
          <li key={s.seq} className="p-3.5">
            <div className="flex items-start gap-2.5 text-sm">
              {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
              <div className="min-w-0">
                <div className="font-bold text-slate-800 dark:text-slate-100">{stepTitle(s)}</div>
                <div className="text-xs text-slate-500 mt-0.5">{ok ? plain(s.expect) : s.plan_result}</div>
                {s.plan_output && (
                  <details className="mt-1.5 text-xs">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">What The OLT Answered</summary>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-900 text-slate-100 p-2 font-mono">{s.plan_output}</pre>
                  </details>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function ApplyCard({ j, h }: { j: Job; h: JobHandle }) {
  const { user } = useAuth()
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'reseller'
  const isAdmin = user?.role === 'admin'
  const [reviewed, setReviewed] = useState(false)
  const steps = j.steps ?? []
  const needsApproval = j.operation === 'change_vlan'
  const open = j.status === 'planned' || j.status === 'approved'
  const canApply = isOperatorOrAdmin && (j.status === 'approved' || (j.status === 'planned' && !needsApproval))
  const selfApproval = needsApproval && j.requested_by === user?.name
  const checks = steps.filter((s) => s.kind === 'read' && s.plan_result)
  const passed = checks.filter((s) => s.plan_result === 'ok').length
  const allPassed = checks.length === passed
  const hasWrite = steps.some((s) => s.kind === 'write')

  return (
    <Card icon={IcoPlay} title="Apply Execution" subtitle="Runs every check again, then makes the change">
      {checks.length > 0 && (
        <p className={`mb-3 flex items-center gap-1.5 text-sm font-semibold ${allPassed ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {allPassed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {passed} of {checks.length} checks passed against the live OLT.
        </p>
      )}
      {open && canApply && (
        <label className="mb-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" className="mt-1 h-4 w-4 rounded accent-primary cursor-pointer" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          <span>I have reviewed the checks{hasWrite ? ' and the exact command to be sent' : ''}.</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        {isAdmin && j.status === 'planned' && needsApproval && (
          <button
            type="button"
            className="btn-secondary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm disabled:opacity-50"
            onClick={() => h.approve.mutate()}
            disabled={selfApproval || h.approve.isPending}
            title={selfApproval ? 'A different administrator must approve' : undefined}
          >
            {h.approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Approve Change
          </button>
        )}
        {canApply && (
          <button
            type="button"
            className="btn-primary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm disabled:opacity-50"
            onClick={() => h.apply.mutate()}
            disabled={!reviewed || !allPassed || h.apply.isPending}
          >
            {h.apply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Apply To OLT
          </button>
        )}
        {isOperatorOrAdmin && open && (
          <button
            type="button"
            className="py-2 px-4 rounded-xl font-bold text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-2 text-sm disabled:opacity-50"
            onClick={() => h.reject.mutate()}
            disabled={h.reject.isPending}
          >
            {h.reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Discard Job
          </button>
        )}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <CircleDashed className="h-3.5 w-3.5 shrink-0" />
        Every check runs again against the OLT at apply time to ensure safety.
      </p>
    </Card>
  )
}

export function SaveCard({ j, h }: { j: Job; h: JobHandle }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [confirmSave, setConfirmSave] = useState(false)
  if (j.status !== 'succeeded') return null

  return (
    <Card icon={IcoSave} tone="success" title="Save Configuration On OLT" subtitle="Makes the change survive an OLT restart">
      {j.saved_at ? (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Saved to the OLT configuration by {j.saved_by} on {dateTime(j.saved_at)}.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
            The change is live on the OLT running configuration. Saving writes it permanently so that it survives reboots.
          </p>
          {isAdmin ? (
            <>
              <label className="mb-3 flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" className="mt-1 h-4 w-4 rounded accent-primary cursor-pointer" checked={confirmSave} onChange={(e) => setConfirmSave(e.target.checked)} />
                <span>I verified that the service works and approve saving configuration.</span>
              </label>
              <button
                type="button"
                className="btn-primary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm disabled:opacity-50"
                onClick={() => h.save.mutate()}
                disabled={!confirmSave || h.save.isPending}
              >
                {h.save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Configuration On OLT
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-500">An administrator must approve and save configuration.</p>
          )}
        </>
      )}
    </Card>
  )
}

export function StepList({ j }: { j: Job }) {
  return (
    <ol className="space-y-3">
      {(j.steps ?? []).map((s, i) => (
        <StepCard key={s.seq} s={s} n={i + 1} />
      ))}
    </ol>
  )
}
