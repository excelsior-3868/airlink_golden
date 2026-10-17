import { FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Plus, PlusCircle as IcoPlusCircle, Server as IcoServer, Loader2, ArrowLeft, Edit2, Users } from 'lucide-react'
import { nmsApi, Device, errMsg } from '../../lib/nmsApi'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { ago } from '../../lib/nmsFormat'
import { CustomSelect } from '../../components/ui'
import { Card, ErrorBox, Field, Loading, StatusText, Table, Td, Tr, inputCls, PageTitle } from '../../components/nms/NmsUi'
import EditDeviceModal from '../../components/nms/EditDeviceModal'

const roles = ['core', 'aggregation', 'access', 'olt', 'radio', 'server']

export default function NmsDevices() {
  const { user, can } = useAuth()
  const canManage = can('manage_olts')
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [editingDevice, setEditingDevice] = useState<Device | null>(null)
  const [err, setErr] = useState('')

  // Form states with CustomSelect
  const [role, setRole] = useState('access')
  const [popId, setPopId] = useState('')
  const [parentId, setParentId] = useState('')
  const [pollMethod, setPollMethod] = useState('snmp')
  const [snmpVersion, setSnmpVersion] = useState('2c')
  const [protocol, setProtocol] = useState('telnet')

  const qs = params.toString()
  const list = useQuery({
    queryKey: ['devices', qs],
    queryFn: async () => (await nmsApi.get<Device[]>(`/devices?${qs}`)).data,
    refetchInterval: 15_000,
  })

  const pops = useQuery({
    queryKey: ['pops'],
    queryFn: async () => (await nmsApi.get<{ id: number; name: string }[]>('/pops')).data,
  })

  const resellersQuery = useQuery({
    queryKey: ['resellers-list'],
    queryFn: async () => {
      const res = await api.get('/users', { params: { role: 'reseller', per_page: 200 } })
      return (res.data.data?.data || res.data.data || []) as { id: number; name: string; username: string }[]
    },
    enabled: !!canManage,
  })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => nmsApi.post(role === 'olt' ? '/olts' : '/devices', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['olts'] })
      setAdding(false)
      setErr('')
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const num = (v: string) => (v ? Number(v) : null)
    if (role === 'olt') {
      create.mutate({
        name: f.get('name'),
        ip: f.get('ip'),
        vendor: f.get('vendor'),
        pop_id: num(popId),
        protocol,
        port: Number(f.get('olt_port')) || (protocol === 'telnet' ? 23 : 22),
        username: f.get('olt_user'),
        password: f.get('olt_pass'),
        pon_ports: f.get('pon_ports') || '',
        vlan: num(f.get('vlan') as string),
        gem_port: num(f.get('gem_port') as string),
      })
      return
    }
    create.mutate({
      name: f.get('name'),
      ip: f.get('ip'),
      role,
      vendor: f.get('vendor'),
      pop_id: num(popId),
      parent_id: num(parentId),
      poll_method: pollMethod,
      snmp_version: snmpVersion,
      credential_ref: f.get('credential_ref'),
      tcp_port: Number(f.get('tcp_port')) || 22,
      vlan: num(f.get('vlan') as string),
      gem_port: num(f.get('gem_port') as string),
    })
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="OLTs"
        subtitle="Monitored OLT devices, status, and health metrics"
        icon={<IcoServer size={22} className="text-primary" />}
        action={
          canManage ? (
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              className="btn-primary py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm shadow-sm"
              onClick={() => setAdding((a) => !a)}
            >
              <Plus size={16} /> Add OLT
            </motion.button>
          ) : undefined
        }
      />

      {adding && (
        <Card icon={IcoPlusCircle} tone="success" title="New OLT Registration" subtitle="Register a new OLT for monitoring">
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="OLT Name">
              <input name="name" className={inputCls} placeholder="e.g. core-router-01" required />
            </Field>

            <Field label="Management IP Address">
              <input name="ip" className={inputCls} placeholder="10.0.0.1" required />
            </Field>

            <Field label="Device Role">
              <CustomSelect
                value={role}
                onChange={setRole}
                options={roles.map((r) => ({
                  value: r,
                  label: r.replace(/\b\w/g, (c) => c.toUpperCase()),
                }))}
              />
            </Field>

            <Field label="Hardware Vendor">
              <input name="vendor" className={inputCls} placeholder="MikroTik, Huawei, Cisco..." />
            </Field>

            <Field label="Service VLAN ID">
              <input name="vlan" type="number" min="1" max="4094" className={inputCls} placeholder="e.g. 100" defaultValue={100} />
            </Field>

            <Field label="GEM Port Index">
              <input name="gem_port" type="number" min="0" max="1023" className={inputCls} placeholder="e.g. 1" defaultValue={1} />
            </Field>

            {role === 'olt' && (
              <>
                <Field label="Management Protocol">
                  <CustomSelect
                    value={protocol}
                    onChange={setProtocol}
                    options={[
                      { value: 'telnet', label: 'Telnet' },
                      { value: 'ssh', label: 'SSH' },
                    ]}
                  />
                </Field>
                <Field label="Management Port">
                  <input key={protocol} name="olt_port" type="number" defaultValue={protocol === 'telnet' ? 23 : 22} className={inputCls} />
                </Field>
                <Field label="OLT Username">
                  <input name="olt_user" className={inputCls} autoComplete="off" required />
                </Field>
                <Field label="OLT Password">
                  <input name="olt_pass" type="password" className={inputCls} autoComplete="new-password" required />
                </Field>
                <Field label="PON Ports (Optional)">
                  <input name="pon_ports" className={inputCls} placeholder="0/4/0,0/4/1" />
                </Field>
              </>
            )}

            {role !== 'olt' && (<>
            <Field label="Polling Method">
              <CustomSelect
                value={pollMethod}
                onChange={setPollMethod}
                options={[
                  { value: 'snmp', label: 'SNMP' },
                  { value: 'tcp', label: 'TCP Port Ping' },
                  { value: 'none', label: 'None (Disabled)' },
                ]}
              />
            </Field>

            <Field label="SNMP Version">
              <CustomSelect
                value={snmpVersion}
                onChange={setSnmpVersion}
                options={[
                  { value: '2c', label: 'Version 2c' },
                  { value: '3', label: 'Version 3' },
                ]}
              />
            </Field>

            <Field label="Credential Reference">
              <input name="credential_ref" className={inputCls} placeholder="default" defaultValue="default" />
            </Field>

            <Field label="TCP Polling Port">
              <input name="tcp_port" type="number" defaultValue={22} className={inputCls} />
            </Field>
            </>)}

            <div className="flex items-center gap-2.5 sm:col-span-2 lg:col-span-4 mt-2">
              <button
                type="submit"
                className="btn-primary py-2 px-5 rounded-xl font-bold flex items-center gap-2 text-sm disabled:opacity-50"
                disabled={create.isPending}
              >
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save Device
              </button>
              <button
                type="button"
                className="btn-secondary py-2 px-4 rounded-xl font-bold text-sm"
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            </div>

            {err && (
              <div className="sm:col-span-2 lg:col-span-4">
                <ErrorBox msg={err} />
              </div>
            )}
          </form>
        </Card>
      )}

      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox msg={errMsg(list.error)} />
      ) : (
        <Table
          head={
            canManage
              ? ['Operational Status', 'OLT Name', 'Management IP', 'Role', 'Linked Resellers', 'VLAN', 'Tagged GEM', 'Untagged GEM', 'Default Mode', 'Last Polled', 'Actions']
              : ['Operational Status', 'OLT Name', 'Management IP', 'Role', 'VLAN', 'Tagged GEM', 'Untagged GEM', 'Default Mode', 'Last Polled']
          }
          empty={list.data?.length === 0 ? 'No OLTs Found Matching Criteria.' : undefined}
        >
          {list.data?.map((d) => (
            <Tr key={d.id} onClick={() => nav(`/nms/devices/${d.id}`)}>
              <Td><StatusText s={d.status} /></Td>
              <Td className="font-bold text-slate-800 dark:text-slate-100">{d.name}</Td>
              <Td className="tabular-nums font-mono text-xs">{d.ip}</Td>
              <Td className="capitalize font-medium">{d.role}</Td>
              {canManage && (
                <Td>
                  {d.role === 'olt' ? (
                    (() => {
                      const ids = (d.reseller_ids || '').split(',').map((x) => Number(x.trim())).filter(Boolean)
                      if (ids.length === 0) {
                        return <span className="text-xs text-slate-400 italic">None</span>
                      }
                      return (
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {ids.map((id) => {
                            const r = resellersQuery.data?.find((u) => u.id === id)
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20"
                                title={`Reseller ID: ${id}`}
                              >
                                <Users size={10} />
                                {r?.name || r?.username || `ID ${id}`}
                              </span>
                            )
                          })}
                        </div>
                      )
                    })()
                  ) : (
                    <span className="text-slate-400 text-xs">-</span>
                  )}
                </Td>
              )}
              <Td className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">{d.vlan ?? '-'}</Td>
              <Td className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">{d.gem_port ?? '-'}</Td>
              <Td className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">{d.gem_port_untagged ?? d.gem_port ?? '-'}</Td>
              <Td>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
                    d.default_tag_mode === 'untagged'
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      : 'bg-primary/10 text-primary border border-primary/20'
                  }`}
                >
                  {d.default_tag_mode === 'untagged' ? 'Untagged' : 'Tagged'}
                </span>
              </Td>
              <Td className="text-slate-400 whitespace-nowrap">{ago(d.last_polled_at)}</Td>
              {canManage && (
                <Td>
                  <button
                    type="button"
                    className="btn-secondary py-1 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-xs hover:border-primary/50 text-slate-700 dark:text-slate-200"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingDevice(d)
                    }}
                  >
                    <Edit2 size={13} className="text-primary" /> Edit
                  </button>
                </Td>
              )}
            </Tr>
          ))}
        </Table>
      )}

      {editingDevice && (
        <EditDeviceModal
          device={editingDevice}
          onClose={() => setEditingDevice(null)}
        />
      )}
    </div>
  )
}
