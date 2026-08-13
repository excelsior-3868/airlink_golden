import { useState, useEffect, useMemo } from 'react'
import { Zap, Calendar, Wallet as WalletIcon, ArrowRight, AlertTriangle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, date, bsDate, statusPill } from '../lib/format'
import { Modal, Pill, CustomSelect, Combobox, SelectOption, renderPaymentMethodIcon } from './ui'

interface PppoeRechargeModalProps {
  open: boolean
  onClose: () => void
  customer: any
  onSuccess: () => void
}

export default function PppoeRechargeModal({ open, onClose, customer, onSuccess }: PppoeRechargeModalProps) {
  const { user, refresh } = useAuth()
  const isReseller = user?.role === 'reseller'
  const [planId, setPlanId] = useState<string>('')
  const [periods, setPeriods] = useState<number>(1)
  const [paymentMethod, setPaymentMethod] = useState<string>('wallet')
  const [note, setNote] = useState<string>('')
  const [err, setErr] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)

  const { data: plans = [] } = useQuery<any[]>('plans?type=pppoe&active_only=1', () =>
    api.get('/plans?type=pppoe&active_only=1').then((r) => r.data.data)
  )

  const { data: paymentMethods = [] } = useQuery<any[]>('payment-methods', () =>
    api.get('/payment-methods').then((r) => r.data.data)
  )

  useEffect(() => {
    if (customer && open) {
      setPlanId(String(customer.plan_id || ''))
      setPeriods(1)
      setPaymentMethod('wallet')
      setNote('')
      setErr('')
    }
  }, [customer, open])

  const selectedPlan = useMemo(() => {
    return plans.find((p) => String(p.id) === String(planId)) || customer?.plan || null
  }, [plans, planId, customer])

  const planOptions = useMemo(() => {
    return plans.map((p) => ({
      value: String(p.id),
      label: `${p.name} (${p.bandwidth || 'Unlimited'}) - ${rs(p.selling_price)} / ${p.validity_days} Days`,
      badge: <span className="text-[10px] bg-indigo-50 text-indigo-600 font-bold px-2 py-0.5 rounded-full border border-indigo-100/50">{p.validity_days} Days</span>
    }))
  }, [plans])

  const paymentMethodOptions = useMemo(() => {
    const opts: SelectOption[] = [
      { value: 'wallet', label: 'Wallet Balance' },
      { value: 'cash', label: 'Cash Payment' },
    ]
    // payment_methods columns are `code`/`label`/`icon` — there is no `name`.
    // Wallet and Cash are already offered above, so skip them here.
    const list = Array.isArray(paymentMethods) ? paymentMethods : []
    list.forEach((m: any) => {
      const code = String(m?.code ?? '').toLowerCase()
      if (!code || code === 'wallet' || code === 'cash') return
      opts.push({
        value: code,
        label: m.label || m.code,
        icon: renderPaymentMethodIcon(m.icon, m.code),
      })
    })
    return opts
  }, [paymentMethods])

  // Computed preview calculations matching server arithmetic exactly
  const unitPrice = customer?.contract_price !== null && customer?.contract_price !== undefined
    ? Number(customer.contract_price)
    : (selectedPlan ? Number(selectedPlan.selling_price) : 0)
  const totalAmount = unitPrice * periods
  const validityDaysPerPeriod = selectedPlan ? Number(selectedPlan.validity_days || 30) : 30
  const totalValidityDays = validityDaysPerPeriod * periods

  const baseDate = useMemo(() => {
    if (customer?.expires_at) {
      const exp = new Date(customer.expires_at)
      if (exp > new Date()) {
        return exp
      }
    }
    return new Date()
  }, [customer])

  const newExpiryDate = useMemo(() => {
    const d = new Date(baseDate.getTime())
    d.setDate(d.getDate() + totalValidityDays)
    return d
  }, [baseDate, totalValidityDays])

  const currentWallet = Number(user?.wallet_balance || 0)
  const balanceAfter = currentWallet - totalAmount
  const insufficientBalance = isReseller && balanceAfter < 0

  const handleRecharge = async () => {
    if (!customer) return
    setErr('')
    if (!planId) {
      setErr('Please select an internet plan for the recharge.')
      return
    }
    if (periods < 1) {
      setErr('Validity periods must be at least 1.')
      return
    }
    if (insufficientBalance) {
      setErr('Insufficient wallet balance to perform this recharge.')
      return
    }

    setBusy(true)
    try {
      await api.post(`/pppoe/customers/${customer.id}/recharge`, {
        plan_id: +planId,
        periods,
        payment_method: paymentMethod,
        note: note.trim() || null,
      })

      invalidateCache('pppoe')
      invalidateCache('dashboard')
      invalidateCache('wallet')
      invalidateCache('transactions')
      invalidateCache('accounts')
      await refresh()

      onSuccess()
      onClose()
    } catch (e: any) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!customer) return null

  return (
    <Modal open={open} onClose={onClose} title="Recharge PPPoE Subscriber" widthClassName="max-w-xl">
      <div className="space-y-4">
        {/* Subscriber Overview */}
        <div className="p-3.5 bg-slate-50/80 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium">Subscriber</div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate mt-0.5">{customer.username}</div>
            <div className="text-[11px] text-slate-500 truncate">{customer.full_name}</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium">Current Plan</div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate mt-0.5">{customer.plan?.name || '—'}</div>
            <div className="text-[11px] text-slate-500">{customer.plan?.bandwidth || 'Unlimited'}</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium">Current Expiry</div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{customer.expires_at ? date(customer.expires_at) : 'Not Activated'}</div>
            <div className="text-[11px] text-slate-500">{customer.expires_at ? bsDate(customer.expires_at) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium">Status</div>
            <div className="mt-1">
              <Pill tone={(statusPill[customer.status] as any) || 'info'} className="capitalize">
                {customer.status}
              </Pill>
            </div>
          </div>
        </div>

        {/* Plan Picker */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
            Select Internet Plan <span className="text-rose-500">*</span>
          </label>
          <Combobox
            value={planId}
            onChange={(val) => setPlanId(val)}
            options={planOptions}
            placeholder="Search and select plan..."
          />
        </div>

        {/* Periods & Payment Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
              Validity Periods (Multiples)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={24}
                value={periods}
                onChange={(e) => setPeriods(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                ({totalValidityDays} Days)
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
              Payment Method
            </label>
            <CustomSelect
              value={paymentMethod}
              onChange={(val) => setPaymentMethod(val)}
              options={paymentMethodOptions}
            />
          </div>
        </div>

        {/* Note / Reference */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
            Notes / Reference
          </label>
          <input
            type="text"
            placeholder="Optional transaction reference or receipt number"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
          />
        </div>

        {/* Computed Preview Box */}
        <div className="p-4 bg-gradient-to-br from-indigo-50/70 to-purple-50/70 dark:from-indigo-950/30 dark:to-purple-950/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Zap size={14} className="text-indigo-600 dark:text-indigo-400" />
              Amount Due
            </span>
            <span className="text-base font-bold text-slate-900 dark:text-white">
              {rs(totalAmount)}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-2 border-t border-indigo-100/80 dark:border-indigo-900/40">
            <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Calendar size={14} className="text-indigo-500" />
              New Expiry Date
            </span>
            <div className="text-right">
              <div className="font-semibold text-slate-800 dark:text-slate-100">
                {date(newExpiryDate.toISOString())}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {bsDate(newExpiryDate.toISOString())}
              </div>
            </div>
          </div>

          {isReseller && (
            <div className="pt-2 border-t border-indigo-100/80 dark:border-indigo-900/40 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <WalletIcon size={14} className="text-emerald-500" />
                  Wallet Balance
                </span>
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {rs(currentWallet)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                  <ArrowRight size={14} className="text-indigo-500" />
                  Balance After Recharge
                </span>
                <span className={balanceAfter < 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-600 dark:text-emerald-400'}>
                  {rs(balanceAfter)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Error Pill */}
        {err && (
          <div className="pill danger w-full justify-center py-2 flex items-center gap-1.5 text-xs font-medium">
            <AlertTriangle size={14} />
            {err}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRecharge}
            disabled={busy || !planId || insufficientBalance}
            className="px-5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm hover:shadow transition disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? (
              <>
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <Zap size={14} />
                <span>Complete Recharge</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
