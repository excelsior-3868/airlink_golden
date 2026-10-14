import { ReactNode, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2 } from 'lucide-react'
import { nmsApi, errMsg, Job } from '../../lib/nmsApi'
import { dateTime } from '../../lib/nmsFormat'
import { ApplyCard, ChangeCard, ChecksList, SaveCard, StepList, Troubleshooting, spState, useJob } from './JobPanel'
import { Card, ErrorBox, Loading, StatusText, Table, Td, Tr } from './NmsUi'

export const SN_RE = /^[0-9A-Fa-f]{16}$/

export function toOltSerial(raw?: string | null): string {
  if (!raw) return ''
  const s = String(raw).trim().replace(/[\s\-_:]+/g, '')
  if (/^[A-Za-z]{4}[0-9A-Fa-f]{8}$/.test(s)) {
    const vendor = Array.from(s.slice(0, 4))
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
    return (vendor + s.slice(4)).toUpperCase()
  }
  return s.toUpperCase()
}

export function Stepper({ labels, step, onGo }: { labels: string[]; step: number; onGo: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs sm:text-sm">
      {labels.map((label, i) => {
        const n = i + 1
        const done = n < step
        const cur = n === step
        const canGo = done && step < labels.length
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canGo}
              onClick={() => onGo(n)}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition-all ${
                cur
                  ? 'bg-primary text-white shadow-xs font-bold'
                  : done
                  ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  : 'text-slate-400 dark:text-slate-500'
              } disabled:cursor-default`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                  cur
                    ? 'bg-white text-primary'
                    : done
                    ? 'bg-emerald-500 text-white'
                    : 'border border-slate-300 dark:border-slate-700'
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : n}
              </span>
              <span>{label}</span>
            </button>
            {n < labels.length && <span className="h-px w-4 bg-slate-200 dark:bg-slate-700" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

export function Nav({
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled,
  busy,
  extra,
  hint,
}: {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  nextDisabled?: boolean
  busy?: boolean
  extra?: ReactNode
  hint?: string
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
      {onBack && (
        <button type="button" className="btn-secondary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="btn-primary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm disabled:opacity-50"
          onClick={onNext}
          disabled={nextDisabled || busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {nextLabel} <ArrowRight className="h-4 w-4" />
        </button>
      )}
      {nextDisabled && hint && (
        <div role="status" className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 px-3.5 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          {hint}
        </div>
      )}
      {extra}
    </div>
  )
}

export function StepHead({ n, total, title, hint }: { n: number; total: number; title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-[#003164] dark:text-white">Step {n} of {total}</p>
      <h2 className="text-sm sm:text-base font-bold text-[#003164] dark:text-white">{title}</h2>
      {hint && <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

function ChecksResult({ id }: { id: number }) {
  const h = useJob(id)
  if (h.q.isLoading) return <Loading />
  if (!h.q.data) return null
  const j = h.q.data
  const checks = (j.steps ?? []).filter((s) => s.kind === 'read' && s.plan_result)
  const passed = checks.filter((s) => s.plan_result === 'ok').length
  return (
    <div className="space-y-3">
      <p className={`flex items-center gap-1.5 text-sm font-semibold ${passed === checks.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
        <CheckCircle2 className="h-4 w-4" /> {passed} Of {checks.length} Checks Passed Against The Live OLT.
      </p>
      <ChecksList j={j} />
    </div>
  )
}

export function ChecksStep({
  total,
  summary,
  body,
  jobId,
  staleJobId,
  onPlanned,
  onBack,
  onNext,
}: {
  total: number
  summary: ReactNode
  body: Record<string, unknown>
  jobId: number | null
  staleJobId: number | null
  onPlanned: (id: number) => void
  onBack: () => void
  onNext: () => void
}) {
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const plan = useMutation({
    mutationFn: async () => {
      const old = jobId ?? staleJobId
      if (old) await nmsApi.post(`/jobs/${old}/reject`).catch(() => undefined)
      return (await nmsApi.post<Job>('/jobs', body)).data
    },
    onSuccess: (j) => {
      setErr('')
      qc.invalidateQueries({ queryKey: ['jobs'] })
      onPlanned(j.id)
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <>
      <StepHead n={3} total={total} title="Check The OLT" hint="Reads from the OLT only. Nothing is modified. If a check fails, nothing can be applied." />
      <div className="mb-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4 text-xs sm:text-sm">{summary}</div>
      {!jobId && !plan.isPending && !err && (
        <button type="button" className="btn-primary py-2 px-4 rounded-xl font-bold text-sm" onClick={() => plan.mutate()}>
          Run Checks On OLT
        </button>
      )}
      {plan.isPending && (
        <p className="flex items-center gap-2 text-xs sm:text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading from the OLT. This may take up to a minute...
        </p>
      )}
      {err && (
        <div className="mt-3 space-y-3">
          <ErrorBox msg={err} />
          <Troubleshooting open />
          <button type="button" className="btn-secondary py-2 px-4 rounded-xl font-bold text-sm" onClick={() => plan.mutate()}>
            Run Checks Again
          </button>
        </div>
      )}
      {jobId && <ChecksResult id={jobId} />}
      {jobId && !plan.isPending && (
        <div className="mt-3">
          <button type="button" className="btn-secondary py-2 px-4 rounded-xl font-bold text-sm" onClick={() => plan.mutate()}>
            Run Checks Again
          </button>
        </div>
      )}
      <Nav onBack={onBack} onNext={onNext} nextLabel="Next: Review & Apply" nextDisabled={!jobId || plan.isPending} />
    </>
  )
}

function ReviewStep({
  id,
  total,
  onBack,
  onDone,
  onRestart,
}: {
  id: number
  total: number
  onBack: () => void
  onDone: () => void
  onRestart: () => void
}) {
  const h = useJob(id)
  const j = h.q.data
  useEffect(() => {
    if (j?.status === 'succeeded') onDone()
  }, [j?.status, onDone])

  if (h.q.isLoading) return <Loading />
  if (!j) return <ErrorBox msg="Job not found" />
  const failed = ['failed', 'rolled_back', 'failed_needs_review'].includes(j.status)
  const running = j.status === 'running'

  return (
    <>
      <StepHead n={4} total={total} title="Review And Apply" hint="This is the only step that makes changes to the OLT." />
      {h.err && <div className="mb-3"><ErrorBox msg={h.err} /></div>}
      {running && (
        <p className="mb-3 flex items-center gap-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs sm:text-sm text-blue-700 dark:text-blue-300">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Applying to the OLT. Each check runs again first, then the change is executed...
        </p>
      )}
      {failed && (
        <div className="mb-3 space-y-3">
          <ErrorBox msg={j.error_summary || `The job ${j.status.replace(/_/g, ' ')}.`} />
          <p className="text-xs sm:text-sm text-slate-500">
            {j.status === 'rolled_back'
              ? 'Everything this job changed was successfully undone.'
              : j.status === 'failed_needs_review'
              ? 'Rollback was incomplete. Inspect the OLT directly before proceeding.'
              : 'No changes were made.'}
          </p>
          <Troubleshooting open />
        </div>
      )}
      {!failed && !running && (
        <div className="space-y-4">
          <ChangeCard j={j} title="What Will Be Sent To The OLT" />
          <ApplyCard j={j} h={h} />
        </div>
      )}
      <details className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-xs sm:text-sm bg-white dark:bg-slate-900">
        <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-100">Show Full Steps, Commands & Answers</summary>
        <div className="mt-3"><StepList j={j} /></div>
      </details>
      <Nav
        onBack={!failed && !running && (j.status === 'planned' || j.status === 'approved') ? onBack : undefined}
        extra={
          failed || j.status === 'rejected' ? (
            <button type="button" className="btn-secondary py-2 px-4 rounded-xl font-bold text-sm" onClick={onRestart}>
              Start Over
            </button>
          ) : undefined
        }
      />
    </>
  )
}

function DoneStep({
  id,
  total,
  kind,
  onRestart,
  restartLabel,
}: {
  id: number
  total: number
  kind: 'service' | 'registration'
  onRestart: () => void
  restartLabel: string
}) {
  const h = useJob(id)
  if (h.q.isLoading) return <Loading />
  const j = h.q.data
  if (!j) return <ErrorBox msg="Job not found" />
  const ok = j.status === 'succeeded'
  const verify = (j.steps ?? []).find((s) => s.name === 'verify_service_port')
  const state = verify ? spState(verify.output) : ''
  const writes = (j.steps ?? []).filter((s) => s.kind === 'write' && s.name !== 'save_configuration')

  return (
    <>
      <StepHead n={5} total={total} title={ok ? 'Operation Succeeded' : 'Finished Without Modification'} />
      {ok ? (
        <div className="mb-4 space-y-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 text-xs sm:text-sm">
          <p className="flex items-center gap-2 font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            {kind === 'registration'
              ? 'The ONT was registered and its service-port was created.'
              : 'The service-port was created successfully.'}
          </p>
          {writes.map((w) => (
            <pre key={w.seq} className="overflow-x-auto rounded-xl bg-slate-900 text-slate-100 p-2.5 font-mono text-xs">{w.commands.join('\n')}</pre>
          ))}
          {state && <p className={`font-bold ${state === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>Service-Port State: {state.toUpperCase()}</p>}
        </div>
      ) : (
        <div className="mb-4 space-y-3">
          <ErrorBox msg={j.error_summary || `The job ended as ${j.status.replace(/_/g, ' ')}.`} />
          <Troubleshooting open />
        </div>
      )}
      {h.err && <div className="mb-3"><ErrorBox msg={h.err} /></div>}
      <SaveCard j={j} h={h} />
      <details className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 text-xs sm:text-sm bg-white dark:bg-slate-900">
        <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-100">Show Full Steps, Commands & Answers</summary>
        <div className="mt-3"><StepList j={j} /></div>
      </details>
      <Nav
        extra={
          <button type="button" className="btn-primary py-2 px-4 rounded-xl font-bold text-sm" onClick={onRestart}>
            {restartLabel}
          </button>
        }
      />
    </>
  )
}

export interface ShellProps<F extends object> {
  labels: string[]
  initial: F
  sigOf: (f: F) => string
  fromJob: (params: Record<string, unknown>) => F
  forNext: (f: F) => F
  kind: 'service' | 'registration'
  restartLabel: string
  step1: (a: { f: F; set: (p: Partial<F>) => void; next: () => void }) => ReactNode
  step2: (a: { f: F; set: (p: Partial<F>) => void; back: () => void; next: () => void }) => ReactNode
  checks: (a: {
    f: F
    jobId: number | null
    staleJobId: number | null
    onPlanned: (id: number) => void
    back: () => void
    next: () => void
  }) => ReactNode
}

export function WizardShell<F extends object>(p: ShellProps<F>) {
  const [sp, setSp] = useSearchParams()
  const jobParam = sp.get('job') ? Number(sp.get('job')) : null
  const [step, setStep] = useState<number | null>(jobParam ? null : 1)
  const [f, setF] = useState<F>(p.initial)
  const [planned, setPlanned] = useState<{ id: number; sig: string } | null>(null)
  const set = (patch: Partial<F>) => setF((cur) => ({ ...cur, ...patch }))
  const setJob = (id: number | null) =>
    id ? setSp({ job: String(id) }, { replace: true }) : setSp({}, { replace: true })
  const fresh = planned && planned.sig === p.sigOf(f) ? planned.id : null
  const stale = planned && planned.sig !== p.sigOf(f) ? planned.id : null
  const total = p.labels.length

  const existing = useQuery({
    queryKey: ['job', String(jobParam)],
    enabled: !!jobParam && step === null,
    queryFn: async () => (await nmsApi.get<Job>(`/jobs/${jobParam}`)).data,
  })

  useEffect(() => {
    if (step !== null || !existing.data) return
    const s = existing.data.status
    const loaded = p.fromJob(existing.data.params as Record<string, unknown>)
    setF(loaded)
    setPlanned({ id: existing.data.id, sig: p.sigOf(loaded) })
    if (s === 'planned' || s === 'approved' || s === 'running') setStep(4)
    else if (s === 'rejected') {
      setJob(null)
      setStep(1)
    } else setStep(5)
  }, [existing.data, step])

  const restart = () => {
    setJob(null)
    setPlanned(null)
    setF(p.forNext(f))
    setStep(1)
  }

  if (step === null) return <Loading />
  return (
    <div className="space-y-4">
      <Stepper labels={p.labels} step={step} onGo={(n) => setStep(n)} />
      <div className="glass-card p-6">
        {step === 1 && p.step1({ f, set, next: () => setStep(2) })}
        {step === 2 && p.step2({ f, set, back: () => setStep(1), next: () => setStep(3) })}
        {step === 3 &&
          p.checks({
            f,
            jobId: fresh,
            staleJobId: stale,
            onPlanned: (id) => {
              setPlanned({ id, sig: p.sigOf(f) })
              setJob(id)
            },
            back: () => setStep(2),
            next: () => setStep(4),
          })}
        {step === 4 && jobParam && (
          <ReviewStep id={jobParam} total={total} onBack={() => setStep(3)} onDone={() => setStep(5)} onRestart={restart} />
        )}
        {step === 5 && jobParam && (
          <DoneStep id={jobParam} total={total} kind={p.kind} onRestart={restart} restartLabel={p.restartLabel} />
        )}
      </div>
    </div>
  )
}

export function History({ operations }: { operations?: string[] }) {
  const [, setSp] = useSearchParams()
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: async () => (await nmsApi.get<Job[]>('/jobs')).data,
    refetchInterval: 10_000,
  })
  const rows = (jobs.data ?? []).filter((j) => !operations || operations.includes(j.operation)).slice(0, 25)

  return (
    <details className="glass-card p-5 text-sm">
      <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-100">Job History</summary>
      <div className="mt-3">
        {jobs.isLoading ? (
          <Loading />
        ) : (
          <Table head={['#', 'Operation', 'ONT', 'Status', 'Saved', 'Requested By', 'Created']} empty={rows.length === 0 ? 'No jobs recorded.' : undefined}>
            {rows.map((j) => (
              <Tr
                key={j.id}
                onClick={() => {
                  setSp({ job: String(j.id) })
                  window.location.reload()
                }}
              >
                <Td className="font-bold">{j.id}</Td>
                <Td className="font-semibold text-slate-800 dark:text-slate-200">{j.operation.replace(/_/g, ' ')}</Td>
                <Td className="font-mono text-xs">{String(j.params?.serial ?? '')}</Td>
                <Td><StatusText s={j.status} /></Td>
                <Td>
                  {j.status === 'succeeded' ? (
                    j.saved_at ? (
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Saved</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">Not Saved</span>
                    )
                  ) : (
                    '-'
                  )}
                </Td>
                <Td>{j.requested_by}</Td>
                <Td className="text-slate-400 whitespace-nowrap">{dateTime(j.created_at)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </div>
    </details>
  )
}
