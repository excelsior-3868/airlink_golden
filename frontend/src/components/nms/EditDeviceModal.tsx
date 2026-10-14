import { FormEvent, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, X, Loader2 } from 'lucide-react'
import { nmsApi, Device, errMsg } from '../../lib/nmsApi'
import { CustomSelect } from '../ui'
import { Field, ErrorBox, inputCls } from './NmsUi'

interface EditDeviceModalProps {
  device: Device
  onClose: () => void
  onSuccess?: () => void
}

export default function EditDeviceModal({ device, onClose, onSuccess }: EditDeviceModalProps) {
  const qc = useQueryClient()
  const [name, setName] = useState(device.name || '')
  const [ip, setIp] = useState(device.ip || '')
  const [vendor, setVendor] = useState(device.vendor || '')
  const [vlan, setVlan] = useState(device.vlan !== null && device.vlan !== undefined ? String(device.vlan) : '100')
  const [gemPort, setGemPort] = useState(device.gem_port !== null && device.gem_port !== undefined ? String(device.gem_port) : '1')
  const [gemPortUntagged, setGemPortUntagged] = useState(device.gem_port_untagged !== null && device.gem_port_untagged !== undefined ? String(device.gem_port_untagged) : '2')
  const [defaultTagMode, setDefaultTagMode] = useState<'tagged' | 'untagged'>(device.default_tag_mode === 'untagged' ? 'untagged' : 'tagged')
  const [lineProfile, setLineProfile] = useState(device.line_profile_id != null ? String(device.line_profile_id) : '')
  const [srvProfile, setSrvProfile] = useState(device.srv_profile_id != null ? String(device.srv_profile_id) : '')
  const [lineProfileU, setLineProfileU] = useState(device.line_profile_id_untagged != null ? String(device.line_profile_id_untagged) : '')
  const [srvProfileU, setSrvProfileU] = useState(device.srv_profile_id_untagged != null ? String(device.srv_profile_id_untagged) : '')
  const [err, setErr] = useState('')

  const update = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      return (await nmsApi.patch(`/devices/${device.id}`, payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['olts'] })
      qc.invalidateQueries({ queryKey: ['device', String(device.id)] })
      onSuccess?.()
      onClose()
    },
    onError: (e) => setErr(errMsg(e)),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    const vlanNum = vlan.trim() ? Number(vlan) : null
    const gemNum = gemPort.trim() ? Number(gemPort) : null
    const gemUntaggedNum = gemPortUntagged.trim() ? Number(gemPortUntagged) : null

    if (vlanNum !== null && (isNaN(vlanNum) || vlanNum < 1 || vlanNum > 4094)) {
      setErr('VLAN ID Must Be Between 1 And 4094')
      return
    }
    if (gemNum !== null && (isNaN(gemNum) || gemNum < 0 || gemNum > 1023)) {
      setErr('Tagged GEM Port Index Must Be Between 0 And 1023')
      return
    }
    if (gemUntaggedNum !== null && (isNaN(gemUntaggedNum) || gemUntaggedNum < 0 || gemUntaggedNum > 1023)) {
      setErr('Untagged GEM Port Index Must Be Between 0 And 1023')
      return
    }

    const lpNum = lineProfile.trim() === '' ? null : Number(lineProfile)
    const spNum = srvProfile.trim() === '' ? null : Number(srvProfile)
    const lpuNum = lineProfileU.trim() === '' ? null : Number(lineProfileU)
    const spuNum = srvProfileU.trim() === '' ? null : Number(srvProfileU)
    for (const [label, v] of [['Tagged Line Profile', lpNum], ['Tagged Service Profile', spNum], ['Untagged Line Profile', lpuNum], ['Untagged Service Profile', spuNum]] as const) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > 65535)) {
        setErr(`${label} ID Must Be A Whole Number Between 0 And 65535`)
        return
      }
    }

    update.mutate({
      name: name.trim(),
      ip: ip.trim(),
      vendor: vendor.trim(),
      vlan: vlanNum,
      gem_port: gemNum,
      gem_port_untagged: gemUntaggedNum,
      default_tag_mode: defaultTagMode,
      line_profile_id: lpNum,
      srv_profile_id: spNum,
      line_profile_id_untagged: lpuNum,
      srv_profile_id_untagged: spuNum,
    })
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-4 bg-slate-50/50 dark:bg-slate-900/60">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Server size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Edit OLT</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Configure parameters, VLAN, and GEM Port</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={18} />
            </button>
          </header>

          <form onSubmit={submit} className="p-5 space-y-4">
            {err && <ErrorBox msg={err} />}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="OLT Name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. core-router-01"
                  required
                />
              </Field>

              <Field label="Management IP Address">
                <input
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  className={inputCls}
                  placeholder="10.0.0.1"
                  required
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Hardware Vendor">
                  <input
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    className={inputCls}
                    placeholder="MikroTik, Huawei, Cisco..."
                  />
                </Field>
              </div>

              <Field label="Service VLAN ID">
                <input
                  type="number"
                  min="1"
                  max="4094"
                  value={vlan}
                  onChange={(e) => setVlan(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 100"
                />
              </Field>

              <Field label="Default Tag Mode">
                <CustomSelect
                  value={defaultTagMode}
                  onChange={(v) => setDefaultTagMode(v as 'tagged' | 'untagged')}
                  options={[
                    { value: 'tagged', label: 'Translate (Tagged)' },
                    { value: 'untagged', label: 'Default (Untagged)' },
                  ]}
                />
              </Field>

              <Field label="Tagged GEM Port Index">
                <input
                  type="number"
                  min="0"
                  max="1023"
                  value={gemPort}
                  onChange={(e) => setGemPort(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 1 (Tagged)"
                />
              </Field>

              <Field label="Untagged GEM Port Index">
                <input
                  type="number"
                  min="0"
                  max="1023"
                  value={gemPortUntagged}
                  onChange={(e) => setGemPortUntagged(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 2 (Untagged)"
                />
              </Field>

              <Field label="Tagged Line Profile ID">
                <input
                  type="number"
                  min="0"
                  value={lineProfile}
                  onChange={(e) => setLineProfile(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 4"
                />
              </Field>

              <Field label="Untagged Line Profile ID">
                <input type="number" min="0" value={lineProfileU} onChange={(e) => setLineProfileU(e.target.value)} className={inputCls} placeholder="Blank = auto-pick" />
              </Field>

              <Field label="Untagged Service Profile ID">
                <input type="number" min="0" value={srvProfileU} onChange={(e) => setSrvProfileU(e.target.value)} className={inputCls} placeholder="Blank = auto-pick" />
              </Field>

              <Field label="Tagged Service Profile ID">
                <input
                  type="number"
                  min="0"
                  value={srvProfile}
                  onChange={(e) => setSrvProfile(e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 4"
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary py-2 px-4 rounded-xl font-bold text-xs sm:text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={update.isPending}
                className="btn-primary py-2 px-5 rounded-xl font-bold text-xs sm:text-sm flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {update.isPending && <Loader2 size={16} className="animate-spin" />}
                Save Changes
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
