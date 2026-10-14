import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound as IcoKeyRound, ListChecks as IcoListChecks, Radar as IcoRadar,
  Search, ShieldCheck, Loader2, Plug
} from 'lucide-react'
import { nmsApi, errMsg, Olt } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'
import OltInventory from './OltInventory'
import { Card, ErrorBox, Field, Table, Td, Tr, inputCls } from './NmsUi'
import { CustomSelect } from '../ui'

interface Found {
  F: number
  S: number
  P: number
  SN: string
}

function HostKey({ olt }: { olt: Olt }) {
  const qc = useQueryClient()
  const [fp, setFp] = useState('')
  const [err, setErr] = useState('')

  const fetchKey = useMutation({
    mutationFn: async () => (await nmsApi.post<{ fingerprint: string }>(`/olts/${olt.id}/host-key/fetch`)).data,
    onSuccess: (d) => {
      setFp(d.fingerprint)
      setErr('')
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const trust = useMutation({
    mutationFn: () => nmsApi.post(`/olts/${olt.id}/host-key/trust`, { fingerprint: fp }),
    onSuccess: () => {
      setFp('')
      qc.invalidateQueries({ queryKey: ['olts'] })
    },
    onError: (e) => setErr(errMsg(e)),
  })

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600 dark:text-slate-300">
        The OLT SSH host key is not pinned, so command execution is blocked. Fetch the fingerprint, compare it with the OLT console, then trust it.
      </p>
      {err && <ErrorBox msg={err} />}
      {fp ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 font-mono text-xs">{fp}</code>
          <button
            type="button"
            className="btn-primary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm"
            onClick={() => trust.mutate()}
            disabled={trust.isPending}
          >
            {trust.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verified Fingerprint — Trust
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-secondary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm"
          onClick={() => fetchKey.mutate()}
          disabled={fetchKey.isPending}
        >
          {fetchKey.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Fetch Host Key Fingerprint
        </button>
      )}
    </div>
  )
}

function Login({ olt }: { olt: Olt }) {
  const qc = useQueryClient()
  const [protocol, setProtocol] = useState<string>(olt.protocol ?? 'ssh')
  const [port, setPort] = useState(String(olt.ssh_port ?? (olt.protocol === 'telnet' ? 23 : 22)))
  const [user, setUser] = useState(olt.login_user ?? '')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const save = useMutation({
    mutationFn: () => nmsApi.post(`/olts/${olt.id}/credentials`, { protocol, port: Number(port), username: user, password: pass }),
    onSuccess: () => {
      setPass('')
      setMsg({ ok: true, text: 'Saved.' })
      qc.invalidateQueries({ queryKey: ['olts'] })
    },
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  })
  const test = useMutation({
    mutationFn: async () => (await nmsApi.post<{ ok: boolean; error?: string }>(`/olts/${olt.id}/test`)).data,
    onSuccess: (d) => setMsg(d.ok ? { ok: true, text: 'Connected and logged in.' } : { ok: false, text: d.error ?? 'Failed' }),
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  })

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Protocol">
          <CustomSelect
            value={protocol}
            onChange={(v) => {
              setProtocol(v)
              setPort(v === 'telnet' ? '23' : '22')
            }}
            options={[{ value: 'telnet', label: 'Telnet' }, { value: 'ssh', label: 'SSH' }]}
          />
        </Field>
        <Field label="Port">
          <input className={inputCls} type="number" value={port} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <Field label="Username">
          <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={olt.has_password ? 'Password (leave blank to keep)' : 'Password'}>
          <input className={inputCls} type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      {protocol === 'telnet' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">Telnet sends the login in clear text; keep it on the VPN/private network.</p>
      )}
      {msg && <p className={msg.ok ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-rose-600 dark:text-rose-400 font-semibold'}>{msg.text}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary py-2 px-4 rounded-xl font-bold text-sm flex items-center gap-2" disabled={save.isPending || !user} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
        <button type="button" className="btn-secondary py-2 px-4 rounded-xl font-bold text-sm flex items-center gap-2" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Test Connection
        </button>
      </div>
    </div>
  )
}

export type OltSection = 'login' | 'autofind' | 'inventory' | 'onts'

export function OltDetail({ olt, section }: { olt: Olt; section: OltSection }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isOperatorOrAdmin = user?.role === 'admin' || user?.role === 'reseller'
  const af = useMutation({
    mutationFn: async () => (await nmsApi.get<Found[]>(`/olts/${olt.id}/autofind`)).data,
  })

  return (
    <div className="space-y-6">
      {section === 'login' && isAdmin && (
        <Card icon={Plug} title="Connection & Login" subtitle="How the NMS logs in to this OLT">
          <Login olt={olt} />
        </Card>
      )}

      {section === 'login' && !olt.host_key_pinned && isAdmin && (
        <Card icon={IcoKeyRound} tone="warning" title="SSH Host Key" subtitle="Confirm the OLT identity before logging in">
          <HostKey olt={olt} />
        </Card>
      )}

      {section === 'autofind' && <Card
        icon={IcoRadar}
        tone="warning"
        title="Unregistered ONTs (Autofind)"
        subtitle="Connected to the OLT but not yet registered"
        action={
          isOperatorOrAdmin && olt.host_key_pinned && (
            <button
              type="button"
              className="btn-secondary py-1.5 px-3 rounded-xl font-bold flex items-center gap-1.5 text-xs sm:text-sm"
              onClick={() => af.mutate()}
              disabled={af.isPending}
            >
              {af.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Scan Autofind Now
            </button>
          )
        }
      >
        {af.error && <ErrorBox msg={errMsg(af.error)} />}
        {af.data &&
          (af.data.length === 0 ? (
            <p className="text-xs sm:text-sm text-slate-500">No unregistered ONTs found.</p>
          ) : (
            <Table head={['Serial Number', 'Port (F/S/P)', 'Action']}>
              {af.data.map((f) => (
                <Tr key={f.SN}>
                  <Td className="font-mono font-bold">{f.SN}</Td>
                  <Td>{f.F}/{f.S}/{f.P}</Td>
                  <Td>
                    {isOperatorOrAdmin && (
                      <Link
                        className="text-primary font-bold hover:underline"
                        to={`/nms/provisioning?tab=new&sn=${f.SN}&f=${f.F}&s=${f.S}&p=${f.P}`}
                      >
                        Register ONT
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          ))}
        {!af.data && !af.error && (
          <p className="text-xs sm:text-sm text-slate-500">Scan the OLT for ONTs that are optically connected but not yet provisioned.</p>
        )}
      </Card>}

      {section === 'inventory' && <OltInventory olt={olt} />}

      {section === 'onts' && <Card icon={IcoListChecks} title="Registered ONTs" subtitle="View complete subscriber list">
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
          <span className="font-bold">{olt.onts.toLocaleString()}</span> registered (<span className="text-emerald-600 dark:text-emerald-400 font-bold">{olt.onts_online.toLocaleString()} online</span>).{' '}
          <Link className="text-primary font-bold hover:underline" to="/nms/registered-onts">
            Open The Registered ONTs Page
          </Link>{' '}
          to search and filter by serial or PON port.
        </p>
      </Card>}
    </div>
  )
}
