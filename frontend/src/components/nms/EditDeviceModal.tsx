import { FormEvent, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Server, X, Loader2, Users, Check } from 'lucide-react'
import { nmsApi, Device, errMsg } from '../../lib/nmsApi'
import { CustomSelect } from '../ui'
import { Field, ErrorBox, inputCls } from './NmsUi'

interface EditDeviceModalProps {
  device: Device
  onClose: () => void
  onSuccess?: () => void
}

interface ResellerItem {
  id: number
  username: string
  name: string
  assigned: boolean
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
  const [selectedResellerIds, setSelectedResellerIds] = useState<number[]>([])
  const [resellersInitialized, setResellersInitialized] = useState(false)
  const [err, setErr] = useState('')

  const isOlt = device.role === 'olt'

  const resellersQuery = useQuery({
    queryKey: ['olt-resellers', device.id],
    queryFn: async () => (await nmsApi.get<ResellerItem[]>(`/olts/${device.id}/resellers`)).data,
    enabled: isOlt,
  })

  useEffect(() => {
    if (resellersQuery.data && !resellersInitialized) {
      const assigned = resellersQuery.data.filter((r) => r.assigned).map((r) => r.id)
      setSelectedResellerIds(assigned)
      setResellersInitialized(true)
    }
  }, [resellersQuery.data, resellersInitialized])

  const toggleReseller = (rid: number) => {
    setSelectedResellerIds((prev) =>
      prev.includes(rid) ? prev.filter((id) => id !== rid) : [...prev, rid]
    )
  }

  const update = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await nmsApi.patch(`/devices/${device.id}`, payload)
      if (isOlt) {
        await nmsApi.put(`/olts/${device.id}/resellers`, { reseller_ids: selectedResellerIds })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] })
      qc.invalidateQueries({ queryKey: ['olts'] })
      qc.invalidateQueries({ queryKey: ['device', String(device.id)] })
      qc.invalidateQueries({ queryKey: ['olt-resellers', device.id] })
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
          className="w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl"
        >
          <header className="shrink-0 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-slate-50/50 dark:bg-slate-900/60">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <Server size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Edit OLT</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Configure Parameters, VLAN, And GEM Port</p>
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

          <form onSubmit={submit} className="flex-1 overflow-y-auto p-6 space-y-6">
            {err && <ErrorBox msg={err} />}

            <div className={`grid grid-cols-1 ${isOlt ? 'lg:grid-cols-12' : ''} gap-6 items-start`}>
              {/* Left Column(s): Configuration Form */}
              <div className={`${isOlt ? 'lg:col-span-8' : 'col-span-1'} space-y-5`}>
                {/* Section 1: General & Network */}
                <div>
                  <div className="pb-1 mb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      General & Network Configuration
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

                    <Field label="Hardware Vendor">
                      <input
                        value={vendor}
                        onChange={(e) => setVendor(e.target.value)}
                        className={inputCls}
                        placeholder="MikroTik, Huawei, Cisco..."
                      />
                    </Field>

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

                    <div className="sm:col-span-2">
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
                    </div>
                  </div>
                </div>

                {/* Section 2: Tagged Mode Profiles */}
                <div>
                  <div className="pb-1 mb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Tagged Mode Profiles (802.1Q)
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                </div>

                {/* Section 3: Untagged Mode Profiles */}
                <div>
                  <div className="pb-1 mb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Untagged Mode Profiles (Default)
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

                    <Field label="Untagged Line Profile ID">
                      <input
                        type="number"
                        min="0"
                        value={lineProfileU}
                        onChange={(e) => setLineProfileU(e.target.value)}
                        className={inputCls}
                        placeholder="Blank = Auto-Pick"
                      />
                    </Field>

                    <Field label="Untagged Service Profile ID">
                      <input
                        type="number"
                        min="0"
                        value={srvProfileU}
                        onChange={(e) => setSrvProfileU(e.target.value)}
                        className={inputCls}
                        placeholder="Blank = Auto-Pick"
                      />
                    </Field>
                  </div>
                </div>
              </div>

              {/* Right Column: Linked Resellers Card */}
              {isOlt && (
                <div className="lg:col-span-4 h-full">
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-5 flex flex-col h-full space-y-4 shadow-xs">
                    {/* Card Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 dark:border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                          <Users size={16} />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                            Linked Resellers
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            OLT Access & Ownership
                          </p>
                        </div>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                        {selectedResellerIds.length} Assigned
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Assign Which Resellers Can View This OLT, Perform Provisioning, And Manage Registered ONTs.
                    </p>

                    {/* Reseller List */}
                    <div className="space-y-2 flex-1 max-h-[380px] overflow-y-auto pr-1">
                      {resellersQuery.isLoading ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-8">
                          <Loader2 size={16} className="animate-spin" /> Loading Resellers...
                        </div>
                      ) : (resellersQuery.data?.length ?? 0) === 0 ? (
                        <div className="text-center py-8 px-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
                          <p className="text-xs text-slate-400">No Active Resellers Found In The System.</p>
                        </div>
                      ) : (
                        resellersQuery.data?.map((r) => {
                          const isSelected = selectedResellerIds.includes(r.id)
                          return (
                            <button
                              type="button"
                              key={r.id}
                              onClick={() => toggleReseller(r.id)}
                              className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                                isSelected
                                  ? 'bg-primary/10 border-primary text-slate-900 dark:text-slate-100 dark:bg-primary/20 shadow-xs'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                                    isSelected
                                      ? 'bg-primary text-white'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {r.username.charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold truncate text-slate-800 dark:text-slate-100">
                                    {r.name || r.username}
                                  </p>
                                  <p className="text-[11px] text-slate-400 font-mono truncate">
                                    @{r.username}
                                  </p>
                                </div>
                              </div>

                              <div
                                className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-all ${
                                  isSelected
                                    ? 'bg-primary border-primary text-white'
                                    : 'border-slate-300 dark:border-slate-700 bg-transparent'
                                }`}
                              >
                                {isSelected && <Check size={12} strokeWidth={3} />}
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>

                    {/* Quick Helper Note */}
                    <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-1.5 leading-relaxed">
                      <span className="text-primary font-bold shrink-0">•</span>
                      <span>Only Assigned Resellers Can View This OLT In Their Portal And Provision New ONTs.</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
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
