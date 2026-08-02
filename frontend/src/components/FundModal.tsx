import { useEffect, useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Wallet, Database, Send } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { Modal, CustomSelect, SelectOption } from './ui'

interface FundModalProps {
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  defaultAllocType?: 'gb' | 'wallet'
}

export default function FundModal({ open, onClose, onSuccess, defaultAllocType = 'gb' }: FundModalProps) {
  const { user, refresh } = useAuth()

  // Selection state
  const [targetUserId, setTargetUserId] = useState('')
  const [allocType, setAllocType] = useState<'gb' | 'wallet'>(defaultAllocType)

  // Form values
  const [walletAmount, setWalletAmount] = useState('')
  const [walletNote, setWalletNote] = useState('')

  const [gbAmount, setGbAmount] = useState('')
  const [gbPaid, setGbPaid] = useState('')
  const [gbNote, setGbNote] = useState('')

  const [resellers, setResellers] = useState<any[]>([])
  const [sellers, setSellers] = useState<any[]>([])

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState('')

  // Reset form when modal opens/closes or target user changes
  useEffect(() => {
    if (!open) return
    setTargetUserId('')
    setAllocType(defaultAllocType)
    setWalletAmount('')
    setWalletNote('')
    setGbAmount('')
    setGbPaid('')
    setGbNote('')
    setErr('')
    setSuccess('')
  }, [open, defaultAllocType])

  // Load downlines on mount / user change
  useEffect(() => {
    if (!open || !user) return

    if (user.role === 'admin') {
      // Admin loads both resellers and sellers
      api.get('/users', { params: { role: 'reseller', per_page: 100 } }).then((r) => setResellers(r.data.data?.data || r.data.data || []))
      api.get('/users', { params: { role: 'seller', per_page: 500 } }).then((r) => setSellers(r.data.data?.data || r.data.data || []))
    } else if (user.role === 'reseller') {
      // Reseller loads only their sellers
      api.get('/users', { params: { role: 'seller', per_page: 100 } }).then((r) => setSellers(r.data.data?.data || r.data.data || []))
    }
  }, [user, open])

  // Target User object
  const targetUser = useMemo(() => {
    if (!targetUserId) return null
    const foundReseller = resellers.find((r) => String(r.id) === targetUserId)
    if (foundReseller) return foundReseller
    return sellers.find((s) => String(s.id) === targetUserId) || null
  }, [targetUserId, resellers, sellers])

  // Options list for CustomSelect dropdown — wallet loading is reseller-only
  const selectOptions = useMemo(() => {
    const opts: SelectOption[] = []

    resellers.forEach((r) => {
      opts.push({
        value: String(r.id),
        label: r.name,
        badge: (
          <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full shrink-0 border border-purple-100/50">
            Reseller
          </span>
        )
      })
    })

    if (allocType !== 'wallet') {
      sellers.forEach((s) => {
        opts.push({
          value: String(s.id),
          label: s.name,
          badge: (
            <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full shrink-0 border border-amber-100/50">
              Seller
            </span>
          )
        })
      })
    }

    return opts
  }, [resellers, sellers, allocType])

  // Drop the selected seller if the type switches to wallet (reseller-only)
  useEffect(() => {
    if (allocType === 'wallet' && targetUserId && !resellers.some((r) => String(r.id) === targetUserId)) {
      setTargetUserId('')
    }
  }, [allocType, resellers, targetUserId])

  // Cost and wallet check
  const roundTo2 = (n: number) => Math.round(n * 100) / 100

  const gbCost = useMemo(() => {
    if (!gbAmount || !targetUser) return 0
    return roundTo2(+gbAmount * +(targetUser.gb_rate || 0))
  }, [gbAmount, targetUser])

  const remainingDue = useMemo(() => {
    const paid = gbPaid ? parseFloat(gbPaid) : 0
    return Math.max(roundTo2(gbCost - paid), 0)
  }, [gbCost, gbPaid])

  // Admin→reseller loads are always free — the backend ignores paid_amount and
  // never creates a due balance for this relationship, so don't offer the field.
  const isFreeResellerAlloc = user?.role === 'admin' && targetUser?.role === 'reseller'

  // User balances check
  const isShortGb = useMemo(() => {
    if (allocType !== 'gb' || !gbAmount || !user) return false
    return parseFloat(gbAmount) > +(user.gb_balance || 0)
  }, [allocType, gbAmount, user])

  const isShortWallet = useMemo(() => {
    if (allocType !== 'wallet' || !walletAmount || !user) return false
    return parseFloat(walletAmount) > +(user.wallet_balance || 0)
  }, [allocType, walletAmount, user])

  const handleFund = async () => {
    if (!targetUser) return
    setBusy(true)
    setErr('')
    setSuccess('')

    try {
      if (allocType === 'gb') {
        await api.post('/gb/allocate', {
          user_id: targetUser.id,
          gb_amount: parseFloat(gbAmount),
          paid_amount: isFreeResellerAlloc ? 0 : (gbPaid ? parseFloat(gbPaid) : 0),
          note: gbNote || undefined
        })
        setSuccess(`Successfully allocated ${gb(gbAmount)} to ${targetUser.name}.`)
      } else {
        await api.post('/wallet/load', {
          user_id: targetUser.id,
          amount: parseFloat(walletAmount),
          note: walletNote || undefined
        })
        setSuccess(`Successfully loaded ${rs(walletAmount)} to ${targetUser.name}'s wallet.`)
      }

      refresh()
      if (onSuccess) onSuccess()

      // Reset fields
      setWalletAmount('')
      setGbAmount('')
      setGbPaid('')
      setWalletNote('')
      setGbNote('')
    } catch (e: any) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={allocType === 'wallet' ? 'Load Wallet' : 'Allocate GB'}
      subtitle={allocType === 'wallet' ? 'Select a reseller to load wallet.' : 'Select a reseller or seller to allocate GB data quota.'}
      icon={<Send size={22} className="text-blue-600" />}
      bodyClassName="overflow-visible"
    >
      <div className="space-y-5">
        {/* User Selection */}
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1.5">
            {allocType === 'wallet' ? 'Select Recipient (Reseller)' : 'Select Recipient (Reseller / Seller)'}
          </label>
          <CustomSelect
            className="w-full"
            searchable={true}
            value={targetUserId}
            onChange={(val) => {
              setTargetUserId(val)
              setErr('')
              setSuccess('')
            }}
            placeholder={allocType === 'wallet' ? 'Choose a reseller...' : 'Choose reseller or seller...'}
            options={selectOptions}
          />
        </div>

        {targetUser && (
          <>
            {/* Allocation Type Switch (Admin only) */}
            {user?.role === 'admin' ? (
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-2">
                  Allocation Type
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-100/80 p-1.5 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setAllocType('gb')
                      setErr('')
                      setSuccess('')
                    }}
                    className={`flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-sm font-bold transition-all ${
                      allocType === 'gb'
                        ? 'bg-white text-[#003164] shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Database size={16} />
                    GB Allocation
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAllocType('wallet')
                      setErr('')
                      setSuccess('')
                    }}
                    className={`flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-sm font-bold transition-all ${
                      allocType === 'wallet'
                        ? 'bg-white text-[#003164] shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Wallet size={16} />
                    Wallet Allocation
                  </button>
                </div>
              </div>
            ) : null}

            {/* Recipient current info */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50/50 border border-slate-200/50 p-3 rounded-2xl text-xs">
              <div>
                <p className="text-slate-400 font-semibold">Recipient Current GB:</p>
                <p className="text-slate-800 font-bold mt-0.5">{gb(targetUser.gb_balance)}</p>
              </div>
              <div>
                <p className="text-slate-400 font-semibold">Recipient Current Wallet:</p>
                <p className="text-slate-800 font-bold mt-0.5">{rs(targetUser.wallet_balance)}</p>
              </div>
            </div>

            {/* Form Fields based on selection */}
            {allocType === 'gb' ? (
              <div className="space-y-4">
                {/* GB amount */}
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1.5 flex items-center gap-1">
                    <Database size={14} className="text-cyan-500" />
                    GB Amount
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="0.001"
                    step="0.001"
                    placeholder="e.g. 500"
                    value={gbAmount}
                    onChange={(e) => setGbAmount(e.target.value)}
                  />
                </div>

                {/* Calculation breakdown */}
                {+gbAmount > 0 && (
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-semibold">Allocation Cost</span>
                      <span className="font-bold text-slate-800">{rs(gbCost)}</span>
                      <span className="text-[10px] text-slate-400">@ {rs(targetUser.gb_rate)}/GB</span>
                    </div>

                    {isFreeResellerAlloc ? (
                      <div className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl">
                        Free — reseller allocations create no due balance. Admin's revenue comes from the commission cut on voucher sales instead.
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Wallet size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            className="input pl-10"
                            type="number"
                            min="0"
                            max={gbCost}
                            step="0.01"
                            placeholder="Paid now (Rs) — optional"
                            value={gbPaid}
                            onChange={(e) => setGbPaid(e.target.value)}
                          />
                        </div>

                        <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/70">
                          <span className="text-slate-500 font-semibold">Remaining Due (added to debt)</span>
                          <span className={`font-bold ${remainingDue > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {rs(remainingDue)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Note */}
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1.5">
                    Note / Reference
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Quota extension"
                    value={gbNote}
                    onChange={(e) => setGbNote(e.target.value)}
                  />
                </div>

                {/* Available Balance */}
                <div className="text-xs text-slate-500">
                  Your Available GB Balance: <span className="font-bold text-slate-700">{gb(user?.gb_balance || 0)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Wallet load amount */}
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1.5 flex items-center gap-1">
                    <Wallet size={14} className="text-emerald-500" />
                    Wallet Amount (Rs.)
                  </label>
                  <input
                    className="input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="e.g. 1000"
                    value={walletAmount}
                    onChange={(e) => setWalletAmount(e.target.value)}
                  />
                </div>

                {/* Note */}
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1.5">
                    Note / Reference
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Advance deposit"
                    value={walletNote}
                    onChange={(e) => setWalletNote(e.target.value)}
                  />
                </div>

                {/* Available Balance */}
                <div className="text-xs text-slate-500">
                  Your Available Wallet Balance: <span className="font-bold text-slate-700">{rs(user?.wallet_balance || 0)}</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Feedback messages */}
        {err && <div className="pill danger w-full justify-center py-2.5 text-xs font-semibold">{err}</div>}
        {success && <div className="pill success w-full justify-center py-2.5 text-xs font-semibold">{success}</div>}

        {/* Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all"
            onClick={onClose}
          >
            Close
          </button>
          {targetUser && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              disabled={
                busy ||
                (allocType === 'gb' && (!gbAmount || isShortGb)) ||
                (allocType === 'wallet' && (!walletAmount || isShortWallet))
              }
              onClick={handleFund}
              className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
            >
              {busy ? (
                'Processing...'
              ) : allocType === 'gb' ? (
                <>
                  <Database size={15} />
                  Allocate GB
                </>
              ) : (
                <>
                  <Wallet size={15} />
                  Load Wallet
                </>
              )}
            </motion.button>
          )}
        </div>
      </div>
    </Modal>
  )
}
