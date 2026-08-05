import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Ticket, AlertTriangle, Printer, Zap } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { GlassCard, PageTitle, CustomSelect, SelectOption } from '../components/ui'
import { VoucherCard, CardTemplate } from '../components/VoucherCard'

export default function VoucherGenerator() {
  const { user, refresh } = useAuth()
  const navigate = useNavigate()

  // Fetch reference on load
  const [plans, setPlans] = useState<any[]>([])
  const [bandwidths, setBandwidths] = useState<any[]>([])
  const [permissions, setPermissions] = useState<any[]>([])
  const [cardTemplate, setCardTemplate] = useState<CardTemplate | null>(null)

  useEffect(() => {
    api.get('/plans', { params: { active_only: 1 } }).then((r) => setPlans(r.data.data))
    api.get('/bandwidths').then((r) => setBandwidths(r.data.data))
    api.get('/permissions').then((r) => setPermissions(r.data.data))
    api.get('/voucher-template').then((r) => setCardTemplate(r.data.data))
  }, [])

  // Quick Sales Portal downline mapping
  const [allResellers, setAllResellers] = useState<any[]>([])
  const [allSellers, setAllSellers] = useState<any[]>([])

  useEffect(() => {
    if (!user) return
    if (user.role === 'admin') {
      api.get('/users', { params: { role: 'reseller', per_page: 100 } }).then((r) => setAllResellers(r.data.data.data))
      api.get('/users', { params: { role: 'seller', per_page: 500 } }).then((r) => setAllSellers(r.data.data.data))
    } else if (user.role === 'reseller') {
      setAllResellers([])
      api.get('/users', { params: { role: 'seller', per_page: 100 } }).then((r) => setAllSellers(r.data.data.data))
    }
  }, [user])

  const canCustomize = (feature: string) => {
    if (user?.role === 'admin') return true
    const perm = permissions.find((p) => p.feature === feature)
    return perm ? !!perm[user!.role] : false
  }

  // Generator state
  const [gen, setGen] = useState<any>({
    plan_id: '', quantity: 1, validity_days: '', custom_price: '', custom_base_price: '',
    custom_name: '', custom_plan_type: 'data', custom_bandwidth_id: '', custom_data_gb: '',
    custom_validity_days: '', custom_selling_price: '', custom_base_price_val: '', custom_purchase_source: 'gb',
    reseller_id: '', seller_id: ''
  })
  const [result, setResult] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const selectedPlan = useMemo(() => plans.find((p) => p.id === +gen.plan_id), [plans, gen.plan_id])

  const targetUser = useMemo(() => {
    if (gen.seller_id) {
      return allSellers.find((s) => s.id === +gen.seller_id)
    }
    if (gen.reseller_id) {
      return allResellers.find((r) => r.id === +gen.reseller_id)
    }
    return user
  }, [gen.reseller_id, gen.seller_id, allResellers, allSellers, user])

  const targetGbBalance = targetUser ? +targetUser.gb_balance : 0
  const targetWalletBalance = targetUser ? +targetUser.wallet_balance : 0

  const totalGbRequired = useMemo(() => {
    if (gen.plan_id === 'custom') {
      const customPlanGb = gen.custom_plan_type === 'data' ? (+gen.custom_data_gb || 0) : 0
      return customPlanGb * gen.quantity
    }
    return selectedPlan ? (selectedPlan.data_gb || 0) * gen.quantity : 0
  }, [selectedPlan, gen.plan_id, gen.custom_plan_type, gen.custom_data_gb, gen.quantity])

  const totalWalletCost = useMemo(() => {
    if (gen.plan_id === 'custom') {
      return (+gen.custom_selling_price || 0) * gen.quantity
    }
    const price = selectedPlan ? +selectedPlan.selling_price : 0
    return price * gen.quantity
  }, [selectedPlan, gen.plan_id, gen.custom_selling_price, gen.quantity])

  const purchaseSource = gen.custom_purchase_source || 'gb'
  // Only admin/reseller can generate on behalf of a downline user.
  const canDelegate = user?.role === 'admin' || user?.role === 'reseller'

  const isGenShortGb = purchaseSource === 'gb' && totalGbRequired > targetGbBalance
  const isGenShortWallet = purchaseSource === 'wallet' && totalWalletCost > targetWalletBalance

  const filteredPlans = useMemo(() => {
    if (purchaseSource === 'wallet') {
      // Wallet Balance: only Admin-created wallet hotspot plans, no custom option
      return plans.filter((p) => p.type === 'hotspot' && p.package_type === 'wallet' && (!p.creator || p.creator.role === 'admin'))
    }
    // GB Allocation: only GB packages
    return plans.filter((p) => p.type === 'hotspot' && p.package_type === 'gb')
  }, [plans, purchaseSource])

  useEffect(() => {
    if (!gen.plan_id) return

    if (purchaseSource === 'gb') {
      // GB: 'custom' is valid; only active GB hotspot plans are valid
      if (gen.plan_id === 'custom') return
      const isValidForGb = plans.some(
        (p) => String(p.id) === String(gen.plan_id) && p.type === 'hotspot' && p.package_type === 'gb'
      )
      if (!isValidForGb) setGen((prev: any) => ({ ...prev, plan_id: '' }))
    } else if (purchaseSource === 'wallet') {
      // Wallet: 'custom' is NOT valid; only admin wallet hotspot plans are valid
      if (gen.plan_id === 'custom') {
        setGen((prev: any) => ({ ...prev, plan_id: '' }))
        return
      }
      const isValidForWallet = plans.some(
        (p) => String(p.id) === String(gen.plan_id) && p.type === 'hotspot' && p.package_type === 'wallet' && (!p.creator || p.creator.role === 'admin')
      )
      if (!isValidForWallet) setGen((prev: any) => ({ ...prev, plan_id: '' }))
    }
  }, [purchaseSource, gen.plan_id, plans])

  const [progress, setProgress] = useState(0)
  const [loadingAction, setLoadingAction] = useState(false)

  const openBlob = async (path: string, params?: any) => {
    setLoadingAction(true)
    setProgress(0)
    
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return 95
        const increment = Math.floor(Math.random() * 8) + 3
        return Math.min(95, prev + increment)
      })
    }, 150)

    try {
      const res = await api.get(path, { params, responseType: 'blob' })
      clearInterval(interval)
      setProgress(100)
      
      await new Promise((r) => setTimeout(r, 200))
      
      const url = URL.createObjectURL(res.data)
      window.open(url, '_blank')
    } catch (e) {
      clearInterval(interval)
      alert(apiError(e))
    } finally {
      setLoadingAction(false)
    }
  }

  const generate = async () => {
    setBusy(true); setErr('')
    try {
      let finalPlanId = gen.plan_id
      
      if (gen.plan_id === 'custom') {
        const payloadPlan: any = {
          via_voucher: true,
          name: gen.custom_name,
          type: 'hotspot',
          plan_type: gen.custom_plan_type || 'data',
          bandwidth_id: gen.custom_bandwidth_id || null,
          data_gb: gen.custom_plan_type === 'data' ? (+gen.custom_data_gb || null) : null,
          validity_days: +gen.custom_validity_days || 30,
          base_price: +gen.custom_base_price_val || 0,
          selling_price: +gen.custom_selling_price || 0,
          status: 'active'
        }
        if (gen.seller_id) {
          payloadPlan.owner_id = +gen.seller_id
        } else if (gen.reseller_id) {
          payloadPlan.owner_id = +gen.reseller_id
        }
        const { data: planRes } = await api.post('/plans', payloadPlan)
        finalPlanId = planRes.data.id
        // reload plans
        const rPl = await api.get('/plans', { params: { active_only: 1 } })
        setPlans(rPl.data.data)
      }

      const selectedPlan = plans.find((p) => String(p.id) === String(finalPlanId))
      const computedSource = selectedPlan?.package_type === 'wallet' ? 'wallet' : (gen.custom_purchase_source || 'gb')

      const payload: any = {
        plan_id: +finalPlanId,
        quantity: +gen.quantity,
        purchase_source: computedSource,
      }
      if (gen.validity_days) payload.validity_days = +gen.validity_days
      if (gen.custom_price) payload.custom_price = +gen.custom_price
      if (gen.custom_base_price) payload.custom_base_price = +gen.custom_base_price
      if (gen.seller_id) {
        payload.owner_id = +gen.seller_id
      } else if (gen.reseller_id) {
        payload.owner_id = +gen.reseller_id
      }
      
      const { data } = await api.post('/vouchers/generate', payload)
      setResult(data.data); refresh()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  const selectOptions = useMemo(() => {
    const opts: SelectOption[] = []
    if (user?.role === 'admin' || user?.role === 'reseller') {
      allResellers.filter((r) => r.id !== user?.id).forEach((r) => {
        opts.push({
          value: `reseller-${r.id}`,
          label: r.name,
          badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50 font-sans">Reseller</span>
        })
      })
    }
    
    allSellers.forEach((s) => {
      opts.push({
        value: `seller-${s.id}`,
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50 font-sans">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers, user])

  return (
    <div className="space-y-6">
      <PageTitle 
        title="Generate Vouchers" 
        subtitle="Create a new batch of hotspot access voucher cards" 
        icon={
          <button 
            onClick={() => navigate('/vouchers')}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-center text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft size={20} />
          </button>
        }
      />

      <GlassCard>
        {result ? (
          <div className="space-y-5">
            {/* Success banner */}
            <div className="bg-emerald-50 border border-emerald-100/60 rounded-2xl px-5 py-4 flex items-center gap-3">
              <Ticket className="text-emerald-500 shrink-0" size={28} />
              <div>
                <p className="font-extrabold text-emerald-800">{result.message}</p>
                <p className="text-xs text-emerald-600 mt-0.5">Batch <span className="font-mono font-bold bg-white/70 px-1.5 py-0.5 rounded-lg border border-emerald-100">{result.batch_code}</span> · {result.quantity} voucher(s) · {result.plan}</p>
              </div>
            </div>

            {/* Card previews */}
            <div>
              <p className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Preview (first {result.sample?.length})</p>
              <div className="flex gap-4 overflow-x-auto pb-3">
                {cardTemplate && result.sample?.map((code: string) => (
                  <VoucherCard
                    key={code}
                    code={code}
                    planName={result.plan}
                    price={gen.custom_price || (gen.plan_id === 'custom' ? gen.custom_selling_price : selectedPlan?.selling_price)}
                    size={220}
                    template={cardTemplate}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-3 border-t border-slate-100">
              <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-5 rounded-2xl font-bold flex items-center gap-2" onClick={() => openBlob('/vouchers/print', { batch: result.batch_code })}>
                <Printer size={15} /> Print All Cards
              </button>
              <button className="btn-primary py-2.5 px-6 rounded-2xl font-bold" onClick={() => navigate('/vouchers')}>Done</button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Delegation is admin/reseller only; Purchase Source is available to all roles. */}
            <div className={`grid grid-cols-1 ${canDelegate ? 'md:grid-cols-2' : ''} gap-4 p-4 bg-slate-50/50 border border-slate-200/50 rounded-2xl`}>
              {canDelegate && (
                <div className="flex flex-col">
                  <label className="text-xs font-bold text-slate-500 mb-1.5">Generate On Behalf Of</label>
                  <CustomSelect
                    className="w-full"
                    searchable={true}
                    value={gen.seller_id ? `seller-${gen.seller_id}` : (gen.reseller_id ? `reseller-${gen.reseller_id}` : '')}
                    onChange={(val) => {
                      if (!val) {
                        setGen({ ...gen, reseller_id: '', seller_id: '' })
                      } else if (val.startsWith('reseller-')) {
                        const rId = val.replace('reseller-', '')
                        setGen({ ...gen, reseller_id: rId, seller_id: '' })
                      } else if (val.startsWith('seller-')) {
                        const sId = val.replace('seller-', '')
                        const sObj = allSellers.find(s => String(s.id) === sId)
                        setGen({ ...gen, seller_id: sId, reseller_id: sObj ? String(sObj.parent_id) : '' })
                      }
                    }}
                    placeholder={user?.role === 'admin' ? "Myself (Admin)" : "Myself (Reseller)"}
                    options={[
                      { value: '', label: user?.role === 'admin' ? 'Myself (Admin)' : 'Myself (Reseller)' },
                      ...selectOptions
                    ]}
                  />
                </div>
              )}

              <div className="flex flex-col">
                <label className="text-xs font-bold text-slate-500 mb-1.5">Purchase Source (Deduct Balance)</label>
                <CustomSelect
                  className="w-full"
                  value={gen.custom_purchase_source || 'gb'}
                  onChange={(val) => setGen({ ...gen, custom_purchase_source: val })}
                  options={[
                    { value: 'gb', label: 'GB Allocation', badge: (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${targetGbBalance > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-500 border-rose-100'}`}>
                        {gb(targetGbBalance)}
                      </span>
                    )},
                    { value: 'wallet', label: 'Wallet Balance', badge: (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${targetWalletBalance > 0 ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-rose-50 text-rose-500 border-rose-100'}`}>
                        {rs(targetWalletBalance)}
                      </span>
                    )}
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-bold text-slate-500 mb-1.5">Select Plan</label>
              <CustomSelect
                className="w-full"
                value={gen.plan_id ? String(gen.plan_id) : ''}
                onChange={(val) => setGen({ ...gen, plan_id: val })}
                placeholder="Select plan..."
                options={[
                  ...(purchaseSource === 'gb' && canCustomize('create_voucher_plan') ? [{ value: 'custom', label: '+ Create Custom Package' }] : []),
                  ...filteredPlans.map((p) => ({
                    value: String(p.id),
                    label: `${p.name}${p.data_gb ? ` — ${gb(p.data_gb)}` : ''}`,
                    badge: p.package_type === 'gb' ? (
                      <span className="text-[10px] bg-emerald-50 text-emerald-600 font-bold px-2 py-0.5 rounded-full shrink-0">GB Package</span>
                    ) : (
                      <span className="text-[10px] bg-sky-50 text-sky-600 font-bold px-2 py-0.5 rounded-full shrink-0">Wallet Package</span>
                    )
                  }))
                ]}
              />
            </div>

            {gen.plan_id === 'custom' && (
              <div className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-200/50">
                <h4 className="font-bold text-xs text-slate-400 tracking-wider mb-2">Custom Package Configuration</h4>
                
                <div>
                  <label className="text-xs font-semibold text-slate-500">Package Name</label>
                  <input className="input mt-1" value={gen.custom_name} onChange={(e) => setGen({ ...gen, custom_name: e.target.value })} placeholder="e.g. Hotel 2GB" />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-slate-500 mb-1">Package Type</label>
                    <CustomSelect
                      className="w-full"
                      value={gen.custom_plan_type}
                      onChange={(val) => setGen({ ...gen, custom_plan_type: val })}
                      options={[
                        { value: 'data', label: 'Data Limit (GB)' },
                        { value: 'unlimited', label: 'Unlimited' }
                      ]}
                    />
                  </div>
                  {gen.custom_plan_type === 'data' && (
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Data Limit (GB)</label>
                      <input className="input mt-1" type="number" min={0} disabled={!canCustomize('customize_plan_data_limit')} value={gen.custom_data_gb} onChange={(e) => setGen({ ...gen, custom_data_gb: e.target.value })} placeholder="e.g. 5" />
                      {!canCustomize('customize_plan_data_limit') && <span className="text-[10px] text-rose-500 font-bold">Locked by Admin</span>}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-slate-500 mb-1">Bandwidth Speed</label>
                    <CustomSelect
                      className="w-full"
                      disabled={!canCustomize('customize_plan_bandwidth')}
                      value={gen.custom_bandwidth_id ? String(gen.custom_bandwidth_id) : ''}
                      onChange={(val) => setGen({ ...gen, custom_bandwidth_id: val })}
                      placeholder="No speed limit"
                      options={[
                        { value: '', label: 'No speed limit' },
                        ...bandwidths.map((b) => ({
                          value: String(b.id),
                          label: `${b.name} (${b.rate_down}${b.rate_down_unit}/${b.rate_up}${b.rate_up_unit})`
                        }))
                      ]}
                    />
                    {!canCustomize('customize_plan_bandwidth') && <span className="text-[10px] text-rose-500 font-bold">Locked by Admin</span>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Validity (Days)</label>
                    <input className="input mt-1" type="number" min={1} disabled={!canCustomize('customize_plan_validity')} value={gen.custom_validity_days} onChange={(e) => setGen({ ...gen, custom_validity_days: e.target.value })} placeholder="e.g. 30" />
                    {!canCustomize('customize_plan_validity') && <span className="text-[10px] text-rose-500 font-bold">Locked by Admin</span>}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500">Retail Price (Selling Price)</label>
                  <input className="input mt-1" type="number" min={0} value={gen.custom_selling_price} onChange={(e) => setGen({ ...gen, custom_selling_price: e.target.value })} placeholder="Rs. 300" />
                </div>
              </div>
            )}

            {/* Quick Quantities */}
            <div>
              <label className="text-xs font-semibold text-slate-500">Quick Quantity</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {[500, 1000, 2000, 5000, 10000, 20000].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    className={`btn-ghost !py-1 !px-2.5 text-xs transition-all ${gen.quantity === qty ? 'bg-primary text-white border-primary' : 'hover:bg-slate-100'}`}
                    onClick={() => setGen({ ...gen, quantity: qty })}
                  >
                    {qty.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><label className="text-xs font-semibold text-slate-500">Quantity</label><input className="input mt-1" type="number" min={1} max={20000} value={gen.quantity} onChange={(e) => setGen({ ...gen, quantity: +e.target.value })} /></div>
              <div><label className="text-xs font-semibold text-slate-500">Validity (days, optional)</label><input className="input mt-1" type="number" disabled={gen.plan_id === 'custom'} value={gen.validity_days} onChange={(e) => setGen({ ...gen, validity_days: e.target.value })} placeholder="Plan default" /></div>
              <div><label className="text-xs font-semibold text-slate-500">Retail Price (Rs., optional)</label><input className="input mt-1" type="number" min={0.00} step="0.01" disabled={gen.plan_id === 'custom'} value={gen.custom_price} onChange={(e) => setGen({ ...gen, custom_price: e.target.value })} placeholder={selectedPlan ? `${selectedPlan.selling_price}` : "Plan default"} /></div>
            </div>

            {gen.plan_id && (
              <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
                {gen.plan_id !== 'custom' && selectedPlan && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Estimated Retail Value</span>
                    <span className="font-bold">
                      {rs(Number(gen.custom_price !== '' ? gen.custom_price : selectedPlan.selling_price) * (gen.quantity || 0))}
                    </span>
                  </div>
                )}
                {purchaseSource === 'gb' ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total GB Required</span>
                      <span className={`font-bold ${isGenShortGb ? 'text-rose-500' : ''}`}>
                        {gb(totalGbRequired)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200/60 pt-1 mt-1 text-xs">
                      <span className="text-slate-500 font-semibold">Available GB Balance ({targetUser?.name || 'Myself'})</span>
                      <span className="font-semibold text-slate-700">{gb(targetGbBalance)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Wallet Cost (Wholesale)</span>
                      <span className={`font-bold ${isGenShortWallet ? 'text-rose-500' : ''}`}>
                        {rs(totalWalletCost)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200/60 pt-1 mt-1 text-xs">
                      <span className="text-slate-500 font-semibold">Available Wallet Balance ({targetUser?.name || 'Myself'})</span>
                      <span className="font-semibold text-slate-700">{rs(targetWalletBalance)}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {isGenShortGb && (
              <div className="pill danger w-full justify-center py-2 gap-1"><AlertTriangle size={14} /> Not enough GB balance</div>
            )}
            {isGenShortWallet && (
              <div className="pill danger w-full justify-center py-2 gap-1"><AlertTriangle size={14} /> Not enough wallet balance</div>
            )}
            {err && <div className="pill danger w-full justify-center py-2">{err}</div>}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
              <button className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2.5 px-6 rounded-2xl font-bold transition-all" onClick={() => navigate('/vouchers')}>Cancel</button>
              <motion.button whileTap={{ scale: 0.95 }} className="btn-primary py-2.5 px-6 rounded-2xl font-bold transition-all shadow-md" disabled={busy || !gen.plan_id || isGenShortGb || isGenShortWallet} onClick={generate}>
                <Zap size={15} />
                {busy ? 'Generating…' : 'Generate Vouchers'}
              </motion.button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Progress Bar Overlay */}
      {loadingAction && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/45 backdrop-blur-sm select-none">
          <div className="bg-white p-6 rounded-[24px] shadow-2xl flex flex-col items-center gap-4 border border-slate-100 max-w-xs text-center w-80">
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden relative">
              <div 
                className="absolute top-0 left-0 h-full bg-[#003164] rounded-full transition-all duration-150 ease-out" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className="mt-1">
              <p className="text-sm font-extrabold text-slate-800">Generating Card Document ({progress}%)</p>
              <p className="text-xs text-slate-400 font-semibold mt-1">Please wait a moment while we render your cards.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
