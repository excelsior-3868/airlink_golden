import { useState, useEffect, useMemo } from 'react'
import { ArrowLeftRight, Calendar, Package, UserCheck, AlertTriangle, CheckCircle2, DollarSign, Clock, ShieldCheck, ArrowDownLeft, ArrowUpRight, Sparkles } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useQuery, invalidateCache } from '../lib/cache'
import { useAuth } from '../lib/auth'
import { rs, date, bsDate } from '../lib/format'
import { Modal, CustomSelect, SelectOption } from './ui'

interface ChangePackageModalProps {
  open: boolean
  onClose: () => void
  customer: any
  onSuccess: () => void
}

export default function ChangePackageModal({ open, onClose, customer, onSuccess }: ChangePackageModalProps) {
  const { user, refresh } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [targetPlanId, setTargetPlanId] = useState<string>('')
  const [mode, setMode] = useState<string>('replace_period')
  const [customPrice, setCustomPrice] = useState<string>('')
  const [customExpiresAt, setCustomExpiresAt] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<string>('wallet')
  const [note, setNote] = useState<string>('')
  const [err, setErr] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)
  const [previewLoading, setPreviewLoading] = useState<boolean>(false)
  const [preview, setPreview] = useState<any>(null)

  const { data: plans = [] } = useQuery<any[]>('plans?type=pppoe&active_only=1', () =>
    api.get('/plans?type=pppoe&active_only=1').then((r) => r.data.data)
  )

  useEffect(() => {
    if (customer && open) {
      setTargetPlanId('')
      setMode('replace_period')
      setCustomPrice('')
      setCustomExpiresAt('')
      setPaymentMethod('wallet')
      setNote('')
      setErr('')
      setPreview(null)
    }
  }, [customer, open])

  const planOptions = useMemo(() => {
    return plans.map((p) => ({
      value: String(p.id),
      label: `${p.name} (${p.bandwidth || 'Unlimited Speed'}) - ${rs(p.selling_price)} / ${p.validity_days} Days`,
      badge: (
        <span className="text-[10px] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-300 font-bold px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-800">
          {p.validity_days} Days
        </span>
      ),
    }))
  }, [plans])

  const modeOptions: SelectOption[] = useMemo(() => [
    {
      value: 'replace_period',
      label: 'Admin Mistake Package Correction (Net Adjustment)',
      sublabel: 'Calculates net price difference from subscription start date. Automatically refunds or debits reseller wallet and reconciles admin commission.',
    },
    {
      value: 'prorated',
      label: 'Prorated Upgrade From Today',
      sublabel: 'Credits unused days of existing plan and starts new plan validity from today.',
    },
    {
      value: 'no_wallet',
      label: 'Direct Plan Switch (Zero Charge)',
      sublabel: 'Updates plan speed attributes without charging or debiting wallet balance.',
    },
    {
      value: 'custom',
      label: 'Custom Price Adjustment',
      sublabel: 'Manually specify custom net adjustment amount and expiry date.',
    },
  ], [])

  const paymentMethodOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = [
      { value: 'wallet', label: 'Reseller Wallet Balance', sublabel: 'Deduct directly from available wallet balance' },
      { value: 'post_to_due', label: 'Post To Reseller Due (Credit Balance)', sublabel: 'Adds unpaid amount to reseller due/IOU' },
      { value: 'cash', label: 'Cash / External Settlement', sublabel: 'Collected outside the system' },
    ]
    return opts
  }, [])

  // Fetch preview when plan, mode or custom price changes
  useEffect(() => {
    if (!customer || !targetPlanId || !open) {
      setPreview(null)
      return
    }

    let isCancelled = false
    setPreviewLoading(true)
    setErr('')

    const params: any = {
      plan_id: +targetPlanId,
      mode,
    }
    if (mode === 'custom' && customPrice !== '') {
      params.custom_price = parseFloat(customPrice) || 0
    }

    api.get(`/pppoe/customers/${customer.id}/change-package-preview`, { params })
      .then((res) => {
        if (!isCancelled) {
          const data = res.data?.data || null
          setPreview(data)
          // If refund, default payment method to wallet (refund goes to wallet)
          if (data?.action_type === 'refund') {
            setPaymentMethod('wallet')
          }
        }
      })
      .catch((e) => {
        if (!isCancelled) {
          setPreview(null)
          setErr(apiError(e))
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setPreviewLoading(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [customer, targetPlanId, mode, customPrice, open])

  const insufficientBalance = useMemo(() => {
    if (!preview || preview.action_type !== 'charge' || paymentMethod !== 'wallet') return false
    return !preview.has_sufficient_balance
  }, [preview, paymentMethod])

  const handleApply = async () => {
    if (!customer || !targetPlanId) {
      setErr('Please select a target internet package.')
      return
    }
    if (insufficientBalance) {
      setErr("Insufficient reseller wallet balance. Select 'Post To Reseller Due' or 'Cash / External Settlement' to proceed.")
      return
    }

    setBusy(true)
    setErr('')

    try {
      const payload: any = {
        plan_id: +targetPlanId,
        mode,
        payment_method: paymentMethod,
        note: note.trim() || null,
      }
      if (mode === 'custom' && customPrice !== '') {
        payload.custom_price = parseFloat(customPrice) || 0
      }
      if (customExpiresAt) {
        payload.custom_expires_at = customExpiresAt
      }

      await api.post(`/pppoe/customers/${customer.id}/change-package`, payload)

      invalidateCache('pppoe')
      invalidateCache('dashboard')
      invalidateCache('wallet')
      invalidateCache('transactions')
      invalidateCache('accounts')
      invalidateCache('reports')
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

  const isRefund = preview?.action_type === 'refund'
  const isCharge = preview?.action_type === 'charge'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust Subscriber Package"
      icon={<ArrowLeftRight size={20} className="text-indigo-600 dark:text-indigo-400" />}
      widthClassName="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Error Notification */}
        {err && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-500" />
            <span>{err}</span>
          </div>
        )}

        {/* Current Subscriber Overview */}
        <div className="p-3.5 bg-slate-50/80 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
              <UserCheck size={13} className="text-indigo-500" />
              Subscriber
            </div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate mt-0.5">{customer.username}</div>
            <div className="text-[11px] text-slate-500 truncate">{customer.full_name}</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
              <Package size={13} className="text-indigo-500" />
              Current Package
            </div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate mt-0.5">{customer.plan?.name || 'No Plan'}</div>
            <div className="text-[11px] text-slate-500">{customer.plan?.bandwidth || 'Unlimited Speed'}</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
              <Calendar size={13} className="text-indigo-500" />
              Current Expiry
            </div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 mt-0.5">
              {customer.expires_at ? date(customer.expires_at) : 'Not Activated'}
            </div>
            <div className="text-[11px] text-slate-500">{customer.expires_at ? bsDate(customer.expires_at) : '—'}</div>
          </div>
          <div>
            <div className="text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1">
              <ShieldCheck size={13} className="text-indigo-500" />
              Assigned Reseller
            </div>
            <div className="font-semibold text-slate-800 dark:text-slate-100 truncate mt-0.5">
              {customer.reseller?.name || customer.owner?.name || 'Admin Direct'}
            </div>
            <div className="text-[11px] text-slate-500">
              Commission: {customer.reseller?.commission_percent ? `${customer.reseller.commission_percent}%` : '0%'}
            </div>
          </div>
        </div>

        {/* Selection Form */}
        <div className="space-y-3.5">
          {/* Target Package Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Target Package
            </label>
            <CustomSelect
              value={targetPlanId}
              onChange={(val) => setTargetPlanId(val)}
              options={planOptions}
              placeholder="Select Correct Internet Package..."
              searchable
            />
          </div>

          {/* Adjustment Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Adjustment Mode
            </label>
            <CustomSelect
              value={mode}
              onChange={(val) => setMode(val)}
              options={modeOptions}
            />
          </div>

          {/* Custom Mode Fields */}
          {mode === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40 rounded-xl">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Custom Adjustment Amount (Rs.)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder="0.00 (positive for charge, negative for refund)"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Custom Expiration Date
                </label>
                <input
                  type="datetime-local"
                  value={customExpiresAt}
                  onChange={(e) => setCustomExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Live Calculation Preview Breakdown Card */}
        {previewLoading ? (
          <div className="p-6 bg-slate-50/60 dark:bg-slate-800/30 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center gap-2 text-xs text-slate-500">
            <span className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            Calculating financial and accounting reconciliation...
          </div>
        ) : preview ? (
          <div className="p-4 bg-gradient-to-br from-indigo-50/70 via-slate-50/60 to-white dark:from-indigo-950/40 dark:via-slate-900/40 dark:to-slate-900/60 rounded-2xl border border-indigo-100 dark:border-indigo-900/60 space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-indigo-100/80 dark:border-indigo-900/50">
              <div className="flex items-center gap-2">
                <DollarSign size={16} className="text-indigo-600 dark:text-indigo-400" />
                <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                  Financial & Accounting Reconciliation
                </span>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isRefund
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
                  : isCharge
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/80 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                {isRefund ? 'Refund To Reseller' : isCharge ? 'Additional Charge' : 'Zero Net Difference'}
              </span>
            </div>

            {/* Price Calculations Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 bg-white/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                <span className="text-slate-400 text-[11px] block">Current Plan Cost</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">{rs(preview.old_price)}</span>
              </div>
              <div className="p-2.5 bg-white/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                <span className="text-slate-400 text-[11px] block">Target Plan Cost</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">{rs(preview.target_price)}</span>
              </div>
              {preview.unused_credit > 0 && (
                <div className="p-2.5 bg-white/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
                  <span className="text-emerald-600 dark:text-emerald-400 text-[11px] block">Unused Credit</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 block">− {rs(preview.unused_credit)}</span>
                </div>
              )}
              <div className={`p-2.5 rounded-xl border col-span-2 sm:col-span-1 ${
                isRefund
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                  : 'bg-indigo-100/70 dark:bg-indigo-950/70 border-indigo-200/80 dark:border-indigo-800/80'
              }`}>
                <span className={`font-bold text-[11px] block ${isRefund ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-700 dark:text-indigo-300'}`}>
                  {isRefund ? 'Net Refund Amount' : 'Net Payable Amount'}
                </span>
                <span className={`text-base font-extrabold mt-0.5 block ${isRefund ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-700 dark:text-indigo-300'}`}>
                  {isRefund ? `+ ${rs(preview.refund_amount)}` : rs(preview.charge_amount || preview.net_amount)}
                </span>
              </div>
            </div>

            {/* Expiry and Wallet Impact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1">
              <div className="p-3 bg-white/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/50 dark:border-slate-700/50 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-semibold">
                  <Clock size={13} className="text-indigo-500" />
                  Subscription Expiry Adjustment
                </div>
                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Current Expiry:</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {customer.expires_at ? date(customer.expires_at) : 'Not Activated'}
                  </span>
                </div>
                <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold flex items-center justify-between">
                  <span>New Expiry:</span>
                  <span>{date(preview.new_expires_at)} ({bsDate(preview.new_expires_at)})</span>
                </div>
              </div>

              {preview.reseller && (
                <div className="p-3 bg-white/80 dark:bg-slate-800/60 rounded-xl border border-slate-200/50 dark:border-slate-700/50 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-semibold">
                    <UserCheck size={13} className="text-indigo-500" />
                    Reseller Wallet Impact ({preview.reseller.username})
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center justify-between">
                    <span>Balance Before:</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">{rs(preview.reseller.wallet_balance)}</span>
                  </div>
                  <div className={`text-[11px] font-bold flex items-center justify-between ${insufficientBalance ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    <span>Balance After:</span>
                    <span>{rs(preview.reseller.balance_after)}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between pt-0.5 border-t border-slate-100 dark:border-slate-700">
                    <span>Admin Share:</span>
                    <span>
                      {isRefund ? (
                        <span className="text-rose-600 dark:text-rose-400">− {rs(preview.admin_share)} (Clawed Back)</span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400">+ {rs(preview.admin_share)} (Credited)</span>
                      )}
                    </span>
                  </div>
                  {preview.reseller.commission_due !== undefined && (
                    <div className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>Commission Due:</span>
                      <span>
                        {rs(preview.reseller.commission_due)} → {rs(preview.reseller.commission_due_after)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Refund Banner */}
            {isRefund && (
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200 font-medium">
                <ArrowDownLeft size={16} className="text-emerald-600 shrink-0" />
                <span>
                  <strong>Accounting Action:</strong> {rs(preview.refund_amount)} will be credited back to reseller wallet. Admin commission of {rs(preview.admin_share)} will be reversed and reseller commission due reduced.
                </span>
              </div>
            )}

            {/* Insufficient balance warning */}
            {insufficientBalance && (
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300 font-medium">
                <AlertTriangle size={15} className="text-rose-500 shrink-0" />
                Reseller has insufficient wallet balance ({rs(preview.reseller.wallet_balance)}) to cover {rs(preview.net_amount)}. You can switch Payment Method below to &apos;Post To Reseller Due&apos; or &apos;Cash / External Settlement&apos;.
              </div>
            )}
          </div>
        ) : null}

        {/* Additional Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Payment Method
            </label>
            <CustomSelect
              value={paymentMethod}
              onChange={(val) => setPaymentMethod(val)}
              options={paymentMethodOptions}
              disabled={isRefund}
            />
            {isRefund && (
              <span className="text-[11px] text-slate-500 mt-1 block">
                Refund is credited automatically to Reseller Wallet.
              </span>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Adjustment Note
            </label>
            <div className="relative">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for package adjustment..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200/80 dark:border-slate-800/80">
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
            onClick={handleApply}
            disabled={busy || !targetPlanId || insufficientBalance || previewLoading}
            className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition shadow-md shadow-indigo-500/20 flex items-center gap-1.5"
          >
            {busy ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Applying Adjustment...
              </>
            ) : isRefund ? (
              <>
                <CheckCircle2 size={14} />
                Confirm Refund & Adjust Package
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                Apply Package Adjustment
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
