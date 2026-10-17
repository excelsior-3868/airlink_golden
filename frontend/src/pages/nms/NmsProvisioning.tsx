import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  BadgeCheck as IcoBadgeCheck, PackagePlus as IcoPackagePlus,
  Radar, Search, Layers, Loader2, CheckCircle2, UserCheck
} from 'lucide-react'
import { nmsApi, errMsg, Olt, OltProfile, Ont } from '../../lib/nmsApi'
import { useAuth } from '../../lib/auth'
import { ChecksStep, History, Nav, SN_RE, StepHead, WizardShell, toOltSerial } from '../../components/nms/Wizard'
import { CustomSelect } from '../../components/ui'
import { Card, ErrorBox, Field, Loading, PageTitle, inputCls } from '../../components/nms/NmsUi'

const LABELS = ['ONT Selection', 'Service Parameters', 'Safety Pre-Checks', 'Review & Apply', 'Completion']
const DESC_RE = /^[A-Za-z0-9 _.-]{0,64}$/

// =========================================================================
// TAB 1: New ONT Registration
// =========================================================================

interface NewForm {
  oltId: number
  serial: string
  frame: string
  slot: string
  port: string
  desc: string
  untagged: boolean
  vlan: string
  gem: string
  lp: string
  sp: string
  allowUndetected: boolean
}

interface Found {
  F: number
  S: number
  P: number
  SN: string
}

function NewOntStep({
  f,
  set,
  olts,
  onNext,
}: {
  f: NewForm
  set: (p: Partial<NewForm>) => void
  olts: Olt[]
  onNext: () => void
}) {
  const ontsQuery = useQuery({
    queryKey: ['onts', f.oltId],
    queryFn: async () => (await nmsApi.get<Ont[]>(`/olts/${f.oltId}/onts`)).data,
    enabled: !!f.oltId,
  })
  const onts = ontsQuery.data
  const oltSerial = toOltSerial(f.serial)
  const validSerial = SN_RE.test(oltSerial)
  const rawInput = (f.serial ?? '').trim().toLowerCase()
  const converted = validSerial && oltSerial.toLowerCase() !== rawInput
  const known = validSerial ? onts?.find((o) => (o?.serial_number ? String(o.serial_number).toUpperCase() === oltSerial : false)) : undefined
  const portOk =
    f.frame !== '' &&
    f.slot !== '' &&
    f.port !== '' &&
    Number(f.port) >= 0 &&
    Number(f.port) <= 15 &&
    Number(f.slot) >= 0 &&
    Number(f.frame) >= 0

  const scan = useMutation({
    mutationFn: async () => (await nmsApi.get<Found[]>(`/olts/${f.oltId}/autofind`)).data,
  })

  const useFound = (o: Found) => {
    set({ serial: o.SN, frame: String(o.F), slot: String(o.S), port: String(o.P) })
  }

  return (
    <>
      <StepHead
        n={1}
        total={LABELS.length}
        title="Which ONT, And Where?"
        hint="Detect new ONTs via OLT autofind or enter the serial and PON port manually."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <Field label="Target Optical Line Terminal (OLT)">
                {olts.length > 1 ? (
                  <CustomSelect
                    value={String(f.oltId)}
                    onChange={(v) => {
                      const newId = Number(v)
                      const targetOlt = olts.find((o) => o.id === newId)
                      const isUntagged = targetOlt?.default_tag_mode === 'untagged'
                      const gemVal = isUntagged
                        ? targetOlt?.gem_port_untagged ?? targetOlt?.gem_port ?? 1
                        : targetOlt?.gem_port ?? 1
                      set({
                        oltId: newId,
                        untagged: isUntagged,
                        gem: String(gemVal),
                        ...(targetOlt?.vlan ? { vlan: String(targetOlt.vlan) } : {}),
                        ...modeProfiles(targetOlt, isUntagged),
                      })
                    }}
                    options={olts.map((o) => ({ value: String(o.id), label: `${o.name} (${o.ip})` }))}
                  />
                ) : (
                  <div className={`${inputCls} flex items-center`}>{olts[0] ? `${olts[0].name} (${olts[0].ip})` : '-'}</div>
                )}
              </Field>
            </div>
            <button
              type="button"
              className="btn-primary py-2.5 px-4 rounded-xl font-bold flex items-center gap-2 text-xs sm:text-sm"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
              Scan OLT
            </button>
          </div>

          {(scan.error || scan.data) && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/40">
            {scan.error && <div className="mt-3"><ErrorBox msg={errMsg(scan.error)} /></div>}
            {scan.data &&
              (scan.data.length === 0 ? (
                <p className="mt-3 text-xs sm:text-sm text-slate-500">
                  No unregistered ONTs found. Verify fiber connection and power on CPE.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm">
                  {scan.data.map((o) => (
                    <li key={`${o.SN}-${o.F}-${o.S}-${o.P}`} className="p-3 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-mono font-bold">{o.SN}</span>
                        <span className="text-slate-400 ml-2">Port: {o.F}/{o.S}/{o.P}</span>
                      </div>
                      <button
                        type="button"
                        className="btn-primary py-1 px-3 rounded-lg text-xs font-bold"
                        onClick={() => useFound(o)}
                      >
                        Select
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-end">
              <div className="col-span-2 sm:col-span-1">
                <Field label="ONT Serial Number">
            <input
              value={f.serial}
              onChange={(e) => set({ serial: e.target.value.trim() })}
              className={`${inputCls} font-mono`}
              placeholder="e.g. 48575443AA960FC8 or ZTEGCF50D2C2"
            />
          </Field>
              </div>
            <Field label="Frame">
              <input
                value={f.frame}
                onChange={(e) => set({ frame: e.target.value })}
                className={inputCls}
                placeholder="0"
              />
            </Field>
            <Field label="Slot">
              <input
                value={f.slot}
                onChange={(e) => set({ slot: e.target.value })}
                className={inputCls}
                placeholder="4"
              />
            </Field>
            <Field label="PON Port">
              <input
                value={f.port}
                onChange={(e) => set({ port: e.target.value })}
                className={inputCls}
                placeholder="7"
              />
            </Field>
            </div>
          </div>

          <Field label="Subscriber Description (Optional)">
            <input
              value={f.desc}
              onChange={(e) => set({ desc: e.target.value })}
              className={inputCls}
              placeholder="Subscriber Name or Circuit ID"
            />
          </Field>

          <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={f.allowUndetected}
              onChange={(e) => set({ allowUndetected: e.target.checked })}
              className="h-4 w-4 rounded accent-primary cursor-pointer"
            />
            <span>Allow Provisioning If ONT Is Not Yet Detected On Fiber (Pre-Provisioning)</span>
          </label>
        </div>

        <aside className="space-y-4">
          {(converted || known || (validSerial && onts && !known)) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 text-xs sm:text-sm space-y-2">
              {converted && (
                <p>
                  Converted Serial: <span className="font-mono font-bold text-primary">{oltSerial}</span>
                </p>
              )}
              {known && (
                <p className="text-rose-600 dark:text-rose-400 font-semibold">
                  This serial is already registered on port {known.frame}/{known.slot}/{known.pon_port} with ONT-ID #{known.ont_id}.
                  Switch to the "Already Registered ONT" tab to add additional VLANs.
                </p>
              )}
              {validSerial && onts && !known && (
                <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Valid new serial. Ready for provisioning on port {f.frame || '0'}/{f.slot || '?'}/{f.port || '?'}.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <Nav
        onNext={onNext}
        nextDisabled={!validSerial || !portOk || !!known || !DESC_RE.test(f.desc)}
        hint={
          !validSerial
            ? 'Complete 16-character hex serial required.'
            : !portOk
            ? 'Specify frame, slot, and port.'
            : known
            ? 'Serial is already registered.'
            : undefined
        }
      />
    </>
  )
}

// Line/service profile defaults an OLT has configured for the given tag mode ('' = not configured).
function modeProfiles(olt: Olt | undefined, untagged: boolean): { lp: string; sp: string } {
  const lp = untagged ? olt?.line_profile_id_untagged : olt?.line_profile_id
  const sp = untagged ? olt?.srv_profile_id_untagged : olt?.srv_profile_id
  return { lp: lp != null ? String(lp) : '', sp: sp != null ? String(sp) : '' }
}

function NewServiceStep({
  f,
  set,
  olts,
  onBack,
  onNext,
}: {
  f: NewForm
  set: (p: Partial<NewForm>) => void
  olts: Olt[]
  onBack: () => void
  onNext: () => void
}) {
  const currentOlt = olts.find((o) => o.id === f.oltId)
  const profilesQuery = useQuery({
    queryKey: ['profiles', f.oltId],
    queryFn: async () => (await nmsApi.get<OltProfile[]>(`/olts/${f.oltId}/profiles`)).data,
    enabled: !!f.oltId,
  })
  const profiles = profilesQuery.data ?? []
  const lineProfiles = profiles.filter((p) => p.profile_type === 'line')
  const srvProfiles = profiles.filter((p) => p.profile_type === 'srv')
  const { lp: deviceLp, sp: deviceSp } = modeProfiles(currentOlt, f.untagged)

  useEffect(() => {
    if (lineProfiles.length === 0 && srvProfiles.length === 0) return

    const updates: Partial<NewForm> = {}
    // OLT Devices default wins when it exists in the catalogue
    const lpValid = lineProfiles.some((p) => String(p.profile_id) === f.lp)
    if (!lpValid && deviceLp && lineProfiles.some((p) => String(p.profile_id) === deviceLp)) {
      updates.lp = deviceLp
    }

    const spValid = srvProfiles.some((p) => String(p.profile_id) === f.sp)
    if (!spValid && deviceSp && srvProfiles.some((p) => String(p.profile_id) === deviceSp)) {
      updates.sp = deviceSp
    }

    if (Object.keys(updates).length > 0) {
      set(updates)
    }
  }, [lineProfiles, srvProfiles, f.lp, f.sp, deviceLp, deviceSp])

  // A service is only provisioned with the line/service profiles configured on the OLT for its mode; never guessed.
  const defaultsMissing =
    profiles.length > 0 &&
    (!lineProfiles.some((p) => String(p.profile_id) === deviceLp) || !srvProfiles.some((p) => String(p.profile_id) === deviceSp))

  const ok =
    Number(f.vlan) >= 1 &&
    Number(f.vlan) <= 4094 &&
    f.gem !== '' &&
    Number(f.gem) >= 0 &&
    Number(f.gem) <= 1023 &&
    f.lp !== '' &&
    f.sp !== '' &&
    !defaultsMissing

  return (
    <>
      <StepHead
        n={2}
        total={LABELS.length}
        title="Service Port & Profile Parameters"
        hint="Configure VLAN, GEM port, and OLT line/service profiles."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service VLAN ID">
              <input
                value={f.vlan}
                readOnly
                disabled
                className={`${inputCls} bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed font-semibold text-slate-700 dark:text-slate-200`}
                placeholder="Configured from OLT Device"
              />
              <span className="text-[11px] text-muted-foreground mt-0.5 block">Auto-loaded from OLT Device Details (view-only)</span>
            </Field>

            <Field label="GEM Port Index">
              <input
                value={f.gem}
                readOnly
                disabled
                className={`${inputCls} bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed font-semibold text-slate-700 dark:text-slate-200`}
                placeholder="Configured from OLT Device"
              />
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                Auto-loaded for {f.untagged ? 'Untagged' : 'Tagged'} Mode (from OLT Device Details)
              </span>
            </Field>
          </div>

          {defaultsMissing && (
            <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-xs sm:text-sm text-red-700 dark:text-red-300">
              {f.untagged ? 'Untagged' : 'Tagged'} line and service profiles are not set for this OLT{currentOlt?.name ? ` (${currentOlt.name})` : ''}. Set the
              {f.untagged ? ' Untagged' : ' Tagged'} Line Profile and Service Profile in the OLT's device settings first{f.untagged ? '' : `, using a line profile that maps VLAN ${f.vlan || '?'} to GEM ${f.gem || '?'}`}, then come back.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Line Profile">
                            <CustomSelect
                value={f.lp}
                onChange={(v) => set({ lp: v })}
                options={lineProfiles.map((p) => ({
                  value: String(p.profile_id),
                  label: `${p.profile_id} - ${p.profile_name || 'Line'}`,
                }))}
              />
              <span className="text-[11px] text-muted-foreground mt-0.5 block">Auto-loaded from OLT Profile Catalogue</span>
            </Field>

            <Field label="Service Profile">
                            <CustomSelect
                value={f.sp}
                onChange={(v) => set({ sp: v })}
                options={srvProfiles.map((p) => ({
                  value: String(p.profile_id),
                  label: `${p.profile_id} - ${p.profile_name || 'Srv'}`,
                }))}
              />
              <span className="text-[11px] text-muted-foreground mt-0.5 block">Auto-loaded from OLT Profile Catalogue</span>
            </Field>
          </div>

          <div className="space-y-2 pt-2">
            <span className="block font-bold text-slate-700 dark:text-slate-200 text-xs sm:text-sm">
              Tag Transformation Mode
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`p-3.5 rounded-xl border text-xs sm:text-sm cursor-pointer transition-all ${
                  !f.untagged
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="tag_mode"
                  checked={!f.untagged}
                  onChange={() => {
                    const taggedGem = currentOlt?.gem_port ?? 1
                    set({ untagged: false, gem: String(taggedGem), ...modeProfiles(currentOlt, false) })
                  }}
                  className="mr-2 accent-primary"
                />
                <span className="font-bold">Translate (Tagged)</span>
                <p className="text-xs text-slate-500 mt-1">Customer frames arrive with 802.1Q VLAN tag.</p>
              </label>

              <label
                className={`p-3.5 rounded-xl border text-xs sm:text-sm cursor-pointer transition-all ${
                  f.untagged
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="tag_mode"
                  checked={f.untagged}
                  onChange={() => {
                    const untaggedGem = currentOlt?.gem_port_untagged ?? currentOlt?.gem_port ?? 1
                    set({ untagged: true, gem: String(untaggedGem), ...modeProfiles(currentOlt, true) })
                  }}
                  className="mr-2 accent-primary"
                />
                <span className="font-bold">Default (Untagged)</span>
                <p className="text-xs text-slate-500 mt-1">Customer frames arrive untagged from ONT.</p>
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-900/40 text-xs sm:text-sm space-y-2">
          <p className="font-bold text-slate-700 dark:text-slate-200">Execution Preview</p>
          <p className="text-slate-500">
            This operation provisions the ONT on port {f.frame || '0'}/{f.slot || '?'}/{f.port || '?'} with line-profile {f.lp ? f.lp : '(select option)'} and service-profile {f.sp ? f.sp : '(select option)'}, then creates a service-port on VLAN {f.vlan || '?'}.
          </p>
        </div>
      </div>

      <Nav onBack={onBack} onNext={onNext} nextDisabled={!ok} />
    </>
  )
}

function NewWizard({ olts }: { olts: Olt[] }) {
  const [sp] = useSearchParams()
  const snParam = sp.get('sn') || ''
  const fParam = sp.get('f') || '0'
  const sParam = sp.get('s') || ''
  const pParam = sp.get('p') || ''

  const defaultOlt = olts[0]
  const isDefaultUntagged = defaultOlt?.default_tag_mode === 'untagged'
  const defaultGem = isDefaultUntagged
    ? defaultOlt?.gem_port_untagged ?? defaultOlt?.gem_port ?? 1
    : defaultOlt?.gem_port ?? 1

  const initialForm: NewForm = {
    oltId: defaultOlt?.id ?? 1,
    serial: snParam,
    frame: fParam,
    slot: sParam,
    port: pParam,
    desc: '',
    untagged: isDefaultUntagged,
    vlan: defaultOlt?.vlan ? String(defaultOlt.vlan) : '100',
    gem: String(defaultGem),
    ...modeProfiles(defaultOlt, isDefaultUntagged),
    allowUndetected: false,
  }

  return (
    <WizardShell<NewForm>
      labels={LABELS}
      initial={initialForm}
      sigOf={(f) => `${f.oltId}:${f.serial}:${f.frame}/${f.slot}/${f.port}:${f.vlan}:${f.gem}:${f.lp}:${f.sp}:${f.untagged}:${f.allowUndetected}:${f.desc}`}
      fromJob={(p) => ({
        oltId: Number(p.olt_id),
        serial: String(p.serial ?? ''),
        frame: String(p.frame ?? '0'),
        slot: String(p.slot ?? ''),
        port: String(p.port ?? ''),
        desc: String(p.description ?? ''),
        untagged: p.tag_transform === 'default',
        vlan: String(p.service_vlan ?? ''),
        gem: String(p.gem_index ?? '1'),
        lp: String(p.line_profile_id ?? '40'),
        sp: String(p.srv_profile_id ?? '40'),
        allowUndetected: !!p.allow_undetected,
      })}
      forNext={(f) => ({ ...f, serial: '', desc: '' })}
      kind="registration"
      olts={olts}
      target={(f) => ({ oltId: f.oltId, serial: f.serial })}
      restartLabel="Register Another ONT"
      step1={({ f, set, next }) => <NewOntStep f={f} set={set} olts={olts} onNext={next} />}
      step2={({ f, set, back, next }) => <NewServiceStep f={f} set={set} olts={olts} onBack={back} onNext={next} />}
      checks={({ f, jobId, staleJobId, onPlanned, back, next }) => {
        const oltSerial = toOltSerial(f.serial)
        const body = {
          olt_id: f.oltId,
          operation: 'register_ont',
          serial: oltSerial,
          frame: Number(f.frame),
          slot: Number(f.slot),
          port: Number(f.port),
          description: f.desc.trim(),
          service_vlan: Number(f.vlan),
          gem: Number(f.gem),
          line_profile_id: Number(f.lp),
          srv_profile_id: Number(f.sp),
          untagged: f.untagged,
          tag_transform: f.untagged ? 'default' : 'translate',
          allow_undetected: f.allowUndetected,
        }
        return (
          <ChecksStep
            total={LABELS.length}
            summary={
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><span className="text-slate-400">Serial:</span> <span className="font-mono font-bold">{oltSerial}</span></div>
                <div><span className="text-slate-400">Port:</span> <span className="font-bold">{f.frame}/{f.slot}/{f.port}</span></div>
                <div><span className="text-slate-400">VLAN:</span> <span className="font-bold">{f.vlan}</span></div>
                <div><span className="text-slate-400">Mode:</span> <span className="font-bold">{f.untagged ? 'Untagged' : 'Tagged'}</span></div>
              </div>
            }
            body={body}
            jobId={jobId}
            staleJobId={staleJobId}
            onPlanned={onPlanned}
            onBack={back}
            onNext={next}
          />
        )
      }}
    />
  )
}

// =========================================================================
// TAB 2: Already Registered ONT (Add Additional Service Port)
// =========================================================================

interface ExistingForm {
  oltId: number
  serial: string
  untagged: boolean
  vlan: string
  gem: string
  uplink: string
  lp: string
}

function ExistingOntStep({
  f,
  set,
  olts,
  onNext,
}: {
  f: ExistingForm
  set: (p: Partial<ExistingForm>) => void
  olts: Olt[]
  onNext: () => void
}) {
  const ontsQuery = useQuery({
    queryKey: ['onts', f.oltId],
    queryFn: async () => (await nmsApi.get<Ont[]>(`/olts/${f.oltId}/onts`)).data,
    enabled: !!f.oltId,
  })
  const onts = ontsQuery.data
  const oltSerial = toOltSerial(f.serial)
  const valid = SN_RE.test(oltSerial)
  const rawInput = (f.serial ?? '').trim().toLowerCase()
  const converted = valid && oltSerial.toLowerCase() !== rawInput
  const needle = oltSerial.toLowerCase()

  const suggestions = useMemo(() => {
    if (needle.length < 3 || valid) return []
    return (onts ?? [])
      .filter((o) => {
        const sn = o.serial_number || ''
        const desc = o.description || ''
        const pos = `${o.frame ?? 0}/${o.slot ?? 0}/${o.pon_port ?? 0}`
        return `${sn}${pos}${desc}`.toLowerCase().includes(needle)
      })
      .slice(0, 6)
  }, [needle, valid, onts])

  const known = valid
    ? onts?.find((o) => (o?.serial_number ? String(o.serial_number).toUpperCase() === oltSerial : false))
    : undefined

  const portsQuery = useQuery({
    queryKey: ['inv', f.oltId, 'service-ports'],
    queryFn: async () => (await nmsApi.get<Record<string, unknown>[]>(`/olts/${f.oltId}/inventory/service-ports`)).data,
    enabled: !!f.oltId,
  })

  const existingServices = useMemo(() => {
    if (!known || !portsQuery.data) return []
    return (portsQuery.data as Record<string, unknown>[]).filter((r) => {
      const fNum = Number(r.frame ?? 0)
      const sNum = Number(r.slot ?? 0)
      const pNum = Number(r.port ?? r.pon_port ?? 0)
      const ontId = Number(r.ont_id ?? 0)
      return fNum === (known.frame ?? 0) && sNum === (known.slot ?? 0) && pNum === (known.pon_port ?? 0) && ontId === (known.ont_id ?? 0)
    })
  }, [known, portsQuery.data])

  return (
    <>
      <StepHead
        n={1}
        total={LABELS.length}
        title="Which Registered ONT?"
        hint="The ONT must already be active on the OLT. Enter its serial number or select from search suggestions."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          {olts.length > 1 && (
            <Field label="Target Optical Line Terminal (OLT)">
              <CustomSelect
                value={String(f.oltId)}
                onChange={(v) => {
                  const newId = Number(v)
                  const targetOlt = olts.find((o) => o.id === newId)
                  const isUntagged = targetOlt?.default_tag_mode === 'untagged'
                  const gemVal = isUntagged
                    ? targetOlt?.gem_port_untagged ?? targetOlt?.gem_port ?? 1
                    : targetOlt?.gem_port ?? 1
                  set({
                    oltId: newId,
                    untagged: isUntagged,
                    gem: String(gemVal),
                    ...(targetOlt?.vlan ? { vlan: String(targetOlt.vlan) } : {}),
                  })
                }}
                options={olts.map((o) => ({ value: String(o.id), label: `${o.name} (${o.ip})` }))}
              />
            </Field>
          )}

          <Field label="ONT Serial Number">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                autoFocus
                value={f.serial}
                onChange={(e) => set({ serial: e.target.value.trim() })}
                className={`${inputCls} pl-9 font-mono`}
                placeholder="e.g. 48575443AA960FC8 or ZTEGCF50D2C2"
              />
            </div>
          </Field>

          {suggestions.length > 0 && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm">
              {suggestions.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => set({ serial: o.serial_number })}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="font-mono font-bold">{o.serial_number}</span>
                    <span className="text-slate-400 text-xs">
                      {o.frame}/{o.slot}/{o.pon_port} #{o.ont_id} • {o.run_state}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside>
          {(converted || known || (valid && onts && !known)) && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 text-xs sm:text-sm space-y-2.5">
              {converted && (
                <p>Converted Serial: <span className="font-mono font-bold text-primary">{oltSerial}</span></p>
              )}
              {known && (
                <>
                  <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    ONT Found: Port {known.frame}/{known.slot}/{known.pon_port}, ONT-ID #{known.ont_id} ({known.run_state || 'unknown'}).
                  </p>
                  {existingServices.length > 0 ? (
                    <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800/60">
                      <p className="font-bold text-slate-700 dark:text-slate-200 mb-1.5 text-xs">Existing Service-Ports On This ONT:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {existingServices.map((sp) => (
                          <span
                            key={String(sp.sp_index)}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                          >
                            <span className="font-bold text-primary">#{String(sp.sp_index)}</span>
                            <span>VLAN {String(sp.vlan ?? sp.vlan_id)}</span>
                            <span className="text-slate-400">(GEM {String(sp.gem)})</span>
                            <span className={`text-[10px] font-bold ${String(sp.state).toLowerCase() === 'up' ? 'text-emerald-600' : 'text-slate-400'}`}>
                              {String(sp.state).toUpperCase()}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-500 text-xs">No active service-ports recorded on this ONT yet.</p>
                  )}
                </>
              )}
              {valid && onts && !known && (
                <p className="text-amber-600 dark:text-amber-400 font-semibold">
                  Not found in the last sync snapshot. The live pre-checks will query the OLT directly.
                </p>
              )}
            </div>
          )}
        </aside>
      </div>

      <Nav onNext={onNext} nextDisabled={!valid} hint={!valid ? 'Enter a valid 16-character serial.' : undefined} />
    </>
  )
}

function ExistingServiceStep({
  f,
  set,
  olts,
  onBack,
  onNext,
}: {
  f: ExistingForm
  set: (p: Partial<ExistingForm>) => void
  olts: Olt[]
  onBack: () => void
  onNext: () => void
}) {
  const currentOlt = olts.find((o) => o.id === f.oltId)
  const profilesQuery = useQuery({
    queryKey: ['profiles', f.oltId],
    queryFn: async () => (await nmsApi.get<OltProfile[]>(`/olts/${f.oltId}/profiles`)).data,
    enabled: !!f.oltId,
  })
  const profiles = profilesQuery.data ?? []
  const lineProfiles = profiles.filter((p) => p.profile_type === 'line')
  const ok =
    Number(f.vlan) >= 1 &&
    Number(f.vlan) <= 4094 &&
    f.gem !== '' &&
    Number(f.gem) >= 0 &&
    Number(f.gem) <= 1023 &&
    /^(\d+\/\d+\/\d+)?$/.test(f.uplink.trim())

  return (
    <>
      <StepHead
        n={2}
        total={LABELS.length}
        title="Service Port Configuration"
        hint="Configure the service VLAN and GEM mapping for this ONT."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service VLAN ID">
              <input
                value={f.vlan}
                readOnly
                disabled
                className={`${inputCls} bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed font-semibold text-slate-700 dark:text-slate-200`}
                placeholder="100"
              />
              <span className="text-[11px] text-muted-foreground mt-0.5 block">Auto-loaded from OLT Device Details (view-only)</span>
            </Field>

            <Field label="GEM Port Index">
              <input
                value={f.gem}
                readOnly
                disabled
                className={`${inputCls} bg-slate-100 dark:bg-slate-800/60 cursor-not-allowed font-semibold text-slate-700 dark:text-slate-200`}
                placeholder="1"
              />
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                Auto-loaded for {f.untagged ? 'Untagged' : 'Tagged'} Mode (from OLT Device Details)
              </span>
            </Field>
          </div>

          <Field label="Uplink Port (Optional Pre-Check)">
            <input
              value={f.uplink}
              onChange={(e) => set({ uplink: e.target.value })}
              className={inputCls}
              placeholder="e.g. 0/9/0"
            />
          </Field>

          {lineProfiles.length > 0 && (
            <Field label="Line Profile (Fallback Verification)">
              <CustomSelect
                value={f.lp}
                onChange={(v) => set({ lp: v })}
                options={[
                  { value: '', label: 'Auto-Detect From Registered ONT' },
                  ...lineProfiles.map((p) => ({
                    value: String(p.profile_id),
                    label: `${p.profile_id} - ${p.profile_name || 'Line'}`,
                  })),
                ]}
              />
            </Field>
          )}

          <div className="space-y-2 pt-2">
            <span className="block font-bold text-slate-700 dark:text-slate-200 text-xs sm:text-sm">
              Tag Transformation Mode
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`p-3.5 rounded-xl border text-xs sm:text-sm cursor-pointer transition-all ${
                  !f.untagged
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="existing_tag_mode"
                  checked={!f.untagged}
                  onChange={() => {
                    const taggedGem = currentOlt?.gem_port ?? 1
                    set({ untagged: false, gem: String(taggedGem) })
                  }}
                  className="mr-2 accent-primary"
                />
                <span className="font-bold">Translate (Tagged)</span>
              </label>

              <label
                className={`p-3.5 rounded-xl border text-xs sm:text-sm cursor-pointer transition-all ${
                  f.untagged
                    ? 'border-primary ring-1 ring-primary bg-primary/5'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="existing_tag_mode"
                  checked={f.untagged}
                  onChange={() => {
                    const untaggedGem = currentOlt?.gem_port_untagged ?? currentOlt?.gem_port ?? 1
                    set({ untagged: true, gem: String(untaggedGem) })
                  }}
                  className="mr-2 accent-primary"
                />
                <span className="font-bold">Default (Untagged)</span>
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-slate-900/40 text-xs sm:text-sm space-y-2">
          <p className="font-bold text-slate-700 dark:text-slate-200">Execution Safety</p>
          <p className="text-slate-500">
            {f.untagged
              ? `This operation removes the ONT's existing untagged service-port on GEM ${f.gem || '?'} (if any), then binds VLAN ${f.vlan || '?'}. Other service-ports are not touched.`
              : `This operation searches for the next free service-port index and binds VLAN ${f.vlan || '?'} to the ONT without touching existing service-ports.`}
          </p>
        </div>
      </div>

      <Nav onBack={onBack} onNext={onNext} nextDisabled={!ok} />
    </>
  )
}

function ExistingWizard({ olts }: { olts: Olt[] }) {
  const [sp] = useSearchParams()
  const snParam = sp.get('sn') || ''

  const defaultOlt = olts[0]
  const isDefaultUntagged = defaultOlt?.default_tag_mode === 'untagged'
  const defaultGem = isDefaultUntagged
    ? defaultOlt?.gem_port_untagged ?? defaultOlt?.gem_port ?? 1
    : defaultOlt?.gem_port ?? 1

  const initialForm: ExistingForm = {
    oltId: defaultOlt?.id ?? 1,
    serial: snParam,
    untagged: isDefaultUntagged,
    vlan: defaultOlt?.vlan ? String(defaultOlt.vlan) : '100',
    gem: String(defaultGem),
    uplink: '',
    lp: '',
  }

  return (
    <WizardShell<ExistingForm>
      labels={LABELS}
      initial={initialForm}
      sigOf={(f) => `${f.oltId}:${f.serial}:${f.vlan}:${f.gem}:${f.untagged}:${f.uplink}:${f.lp}`}
      fromJob={(p) => ({
        oltId: Number(p.olt_id),
        serial: String(p.serial ?? ''),
        untagged: p.tag_transform === 'default',
        vlan: String(p.service_vlan ?? ''),
        gem: String(p.gem_index ?? '1'),
        uplink: String(p.uplink_port ?? ''),
        lp: String(p.line_profile_id ?? ''),
      })}
      forNext={(f) => ({ ...f, serial: '' })}
      kind="service"
      olts={olts}
      target={(f) => ({ oltId: f.oltId, serial: f.serial })}
      restartLabel="Add Another Service Port"
      step1={({ f, set, next }) => <ExistingOntStep f={f} set={set} olts={olts} onNext={next} />}
      step2={({ f, set, back, next }) => <ExistingServiceStep f={f} set={set} olts={olts} onBack={back} onNext={next} />}
      checks={({ f, jobId, staleJobId, onPlanned, back, next }) => {
        const oltSerial = toOltSerial(f.serial)
        const body = {
          olt_id: f.oltId,
          operation: 'add_service_port',
          serial: oltSerial,
          service_vlan: Number(f.vlan),
          gem: Number(f.gem),
          line_profile_id: f.lp ? Number(f.lp) : undefined,
          untagged: f.untagged,
          tag_transform: f.untagged ? 'default' : 'translate',
          uplink_port: f.uplink.trim(),
          replace_untagged: f.untagged,
        }
        return (
          <ChecksStep
            total={LABELS.length}
            summary={
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><span className="text-slate-400">Serial:</span> <span className="font-mono font-bold">{oltSerial}</span></div>
                <div><span className="text-slate-400">VLAN:</span> <span className="font-bold">{f.vlan}</span></div>
                <div><span className="text-slate-400">GEM:</span> <span className="font-bold">{f.gem}</span></div>
                <div><span className="text-slate-400">Mode:</span> <span className="font-bold">{f.untagged ? 'Untagged' : 'Tagged'}</span></div>
              </div>
            }
            body={body}
            jobId={jobId}
            staleJobId={staleJobId}
            onPlanned={onPlanned}
            onBack={back}
            onNext={next}
          />
        )
      }}
    />
  )
}

// =========================================================================
// Main Provisioning Hub with Tabs
// =========================================================================

export default function NmsProvisioning() {
  const [sp, setSp] = useSearchParams()
  const tabParam = sp.get('tab')
  const [tab, setTab] = useState<'new' | 'existing'>(tabParam === 'new' ? 'new' : 'existing')

  const olts = useQuery({
    queryKey: ['olts'],
    queryFn: async () => (await nmsApi.get<Olt[]>('/olts')).data,
  })

  useEffect(() => {
    if (tabParam === 'new' && tab !== 'new') setTab('new')
    if (tabParam === 'existing' && tab !== 'existing') setTab('existing')
  }, [tabParam, tab])

  const switchTab = (t: 'new' | 'existing') => {
    setTab(t)
    setSp((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', t)
      return next
    })
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="OLT Provisioning Hub"
        subtitle="Automated, verified ONT provisioning and service port creation on Huawei OLTs"
        icon={<IcoPackagePlus size={22} className="text-primary" />}
      />

      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2">
        <button
          type="button"
          onClick={() => switchTab('existing')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
            tab === 'existing'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <UserCheck className="h-4 w-4" /> Already Registered ONT
        </button>

        <button
          type="button"
          onClick={() => switchTab('new')}
          className={`py-3 px-5 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
            tab === 'new'
              ? 'border-primary text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Layers className="h-4 w-4" /> New Registration
        </button>
      </div>

      {olts.isLoading ? (
        <Loading />
      ) : (olts.data?.length ?? 0) === 0 ? (
        <Card title="No OLT Available">
          <p className="text-xs sm:text-sm text-slate-500">No Optical Line Terminals configured in the system.</p>
        </Card>
      ) : (
        <>
          {tab === 'existing' && <ExistingWizard olts={olts.data!} />}
          {tab === 'new' && <NewWizard olts={olts.data!} />}
          <History operations={['register_ont', 'add_service_port', 'change_vlan']} />
        </>
      )}
    </div>
  )
}

