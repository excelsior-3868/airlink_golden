import { useEffect, useState } from 'react'
import { api, apiError } from '../lib/api'
import { Modal, CustomSelect, SelectOption } from './ui'

/**
 * The GB Package form — the only kind of plan a non-admin can create.
 *
 * A reseller has no business with the full plan editor: package category and
 * quota type are fixed for them, and pricing beyond a retail price belongs to
 * the operator. This asks for exactly the fields they control.
 *
 * `viaVoucher` picks which permission the API gates on — create_voucher_plan
 * for a package built inline during voucher generation, create_gb_package for
 * one created from the Plans page.
 */
export default function GbPackageModal({
  open,
  onClose,
  onCreated,
  bandwidths = [],
  canDelegate = false,
  delegationOptions = [],
  defaultDelegationValue = '',
  viaVoucher = false,
  title = 'Custom Package Configuration',
}: {
  open: boolean
  onClose: () => void
  onCreated?: (plan: any) => void
  bandwidths?: any[]
  canDelegate?: boolean
  delegationOptions?: SelectOption[]
  defaultDelegationValue?: string
  viaVoucher?: boolean
  title?: string
}) {
  const blank = {
    name: '',
    data_gb: '',
    bandwidth_id: '',
    validity_days: '',
    selling_price: '',
    delegation_id: defaultDelegationValue,
  }

  const [form, setForm] = useState<any>(blank)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Reopening must not show the previous attempt's values or error.
  useEffect(() => {
    if (open) {
      setForm({ ...blank, delegation_id: defaultDelegationValue })
      setErr('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDelegationValue])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name || !form.data_gb || !form.selling_price) {
      setErr('Name, Data Limit, and Retail Price are required.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const payload: any = {
        name: form.name,
        type: 'hotspot',
        package_type: 'gb',
        plan_type: 'data',
        bandwidth_id: form.bandwidth_id || null,
        data_gb: +form.data_gb,
        validity_days: +form.validity_days || 30,
        base_price: 0,
        selling_price: +form.selling_price || 0,
        status: 'active',
      }
      if (viaVoucher) payload.via_voucher = true

      if (form.delegation_id) {
        const [, id] = String(form.delegation_id).split('-')
        if (id) payload.owner_id = +id
      }

      const { data } = await api.post('/plans', payload)
      onCreated?.(data?.data)
      onClose()
    } catch (e: any) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {canDelegate && (
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1.5 block">Plan Owner/Creator</label>
              <CustomSelect
                value={form.delegation_id}
                onChange={(val) => setForm({ ...form, delegation_id: val })}
                options={delegationOptions}
                className="w-full"
              />
            </div>
          )}
          <div className={canDelegate ? '' : 'md:col-span-2'}>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">Package Name</label>
            <input
              required
              className="input w-full"
              placeholder="e.g. Hotel 2GB"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">Package Type</label>
            <CustomSelect
              value="data"
              onChange={() => {}}
              options={[{ value: 'data', label: 'Data Limit (GB)' }]}
              disabled
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">Data Limit (GB)</label>
            <input
              required
              type="number"
              min={1}
              className="input w-full"
              placeholder="e.g. 5"
              value={form.data_gb}
              onChange={(e) => setForm({ ...form, data_gb: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">Bandwidth Speed</label>
            <CustomSelect
              value={form.bandwidth_id}
              onChange={(val) => setForm({ ...form, bandwidth_id: val })}
              options={[
                { value: '', label: 'No speed limit' },
                ...bandwidths.map((b: any) => ({ value: String(b.id), label: b.name })),
              ]}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">Validity (Days)</label>
            <input
              required
              type="number"
              min={1}
              className="input w-full"
              placeholder="e.g. 30"
              value={form.validity_days}
              onChange={(e) => setForm({ ...form, validity_days: e.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1.5 block">Retail Price (Selling Price)</label>
            <input
              required
              type="number"
              min={0}
              className="input w-full"
              placeholder="Rs. 300"
              value={form.selling_price}
              onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
            />
          </div>
        </div>

        {err && <div className="pill danger w-full justify-center py-2">{err}</div>}

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
          <button
            type="button"
            className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2 px-5 rounded-xl font-bold"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary py-2 px-5 rounded-xl font-bold flex items-center gap-1.5"
          >
            {busy ? 'Creating...' : 'Create Package'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
