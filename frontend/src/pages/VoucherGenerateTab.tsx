import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Ticket, AlertTriangle, Printer, Plus, Pencil, Loader2, Wallet, Database, Layers, Sparkles, Search, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { GlassCard, CustomSelect, SelectOption, Modal, Spinner, ConfirmModal } from '../components/ui'
import { VoucherCard, CardTemplate } from '../components/VoucherCard'

const generateDefaultBatchCode = () => {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let rand = ''
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return `BAT${yy}${mm}${dd}${rand}`
}

interface VoucherPackageCardProps {
  p: any
  user: any
  allResellers: any[]
  allSellers: any[]
  selectedOwnerId: string
  onEdit: (plan: any) => void
  onSuccess: (result: any, plan: any) => void
  cardTemplate: CardTemplate | null
  refreshAuth: () => void
}

function VoucherPackageCard({
  p,
  user,
  allResellers,
  allSellers,
  selectedOwnerId,
  onEdit,
  onSuccess,
  cardTemplate,
  refreshAuth
}: VoucherPackageCardProps) {
  const [quantity, setQuantity] = useState<number | ''>('')
  const [batchCode, setBatchCode] = useState(() => generateDefaultBatchCode())
  const [delegationId, setDelegationId] = useState(() => {
    if (selectedOwnerId && selectedOwnerId !== 'all') return selectedOwnerId
    if (p.creator && p.creator.id !== user?.id) return `${p.creator.role}-${p.creator.id}`
    return ''
  })
  const purchaseSource = p.package_type === 'wallet' ? 'wallet' : 'gb'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let next = ''
    if (selectedOwnerId && selectedOwnerId !== 'all') {
      next = selectedOwnerId
    } else if (p.creator && p.creator.id !== user?.id) {
      next = `${p.creator.role}-${p.creator.id}`
    }
    setDelegationId(next)
  }, [p.creator, user?.id, selectedOwnerId])


  // Resolve delegation user
  const targetUser = useMemo(() => {
    if (delegationId) {
      if (delegationId.startsWith('seller-')) {
        const id = +delegationId.replace('seller-', '')
        return allSellers.find((s) => s.id === id)
      }
      if (delegationId.startsWith('reseller-')) {
        const id = +delegationId.replace('reseller-', '')
        return allResellers.find((r) => r.id === id)
      }
    }
    return user
  }, [delegationId, allResellers, allSellers, user])

  // Delegation Options mapping for this card
  const delegationOptions = useMemo(() => {
    const opts: SelectOption[] = []
    if (user?.role === 'admin') {
      opts.push({
        value: '',
        label: 'Admin Direct (Myself)',
        badge: <span className="text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-0.5 rounded-full border border-blue-100/50">Admin</span>
      })
    } else {
      opts.push({ value: '', label: 'Myself' })
    }
    if (user?.role === 'admin' || user?.role === 'reseller') {
      allResellers.filter((r) => r.id !== user?.id).forEach((r) => {
        opts.push({
          value: `reseller-${r.id}`,
          label: r.name,
          badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
        })
      })
    }
    allSellers.forEach((s) => {
      opts.push({
        value: `seller-${s.id}`,
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers, user])

  const targetGbBalance = targetUser?.gb_balance || 0
  const targetWalletBalance = targetUser?.wallet_balance || 0

  const totalGbRequired = useMemo(() => {
    const dataGb = Number(p.data_gb || 0)
    if (dataGb > 0) {
      return dataGb * (quantity || 0)
    }
    const price = Number(p.selling_price || 0)
    const rate = Number(targetUser?.gb_rate || 1)
    if (rate <= 0) return 0
    return (price * (quantity || 0)) / rate
  }, [p.data_gb, p.selling_price, quantity, targetUser?.gb_rate])

  const totalWalletCost = useMemo(() => {
    const price = Number(p.selling_price || 0)
    return price * (quantity || 0)
  }, [p.selling_price, quantity])

  const isShortGb = totalGbRequired > targetGbBalance
  const isShortWallet = totalWalletCost > targetWalletBalance
  const isWallet = p.package_type === 'wallet'
  const isShort = isWallet ? isShortWallet : isShortGb

  const handlePrint = async () => {
    if (!quantity || quantity <= 0) {
      setErr('Enter quantity.')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const payload: any = {
        plan_id: +p.id,
        quantity: +quantity,
        purchase_source: purchaseSource
      }
      if (batchCode) payload.batch_code = batchCode

      if (delegationId) {
        if (delegationId.startsWith('seller-')) {
          payload.owner_id = +delegationId.replace('seller-', '')
        } else if (delegationId.startsWith('reseller-')) {
          payload.owner_id = +delegationId.replace('reseller-', '')
        }
      }

      const { data } = await api.post('/vouchers/generate', payload)
      refreshAuth()
      setBatchCode(generateDefaultBatchCode())
      onSuccess(data.data, p)
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-md relative">
      {/* Processing Cover overlay */}
      {busy && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex flex-col items-center justify-center z-10 transition-all">
          <Loader2 className="animate-spin text-[#003164]" size={36} />
          <p className="text-xs font-extrabold text-[#003164] mt-3">Generating Vouchers...</p>
        </div>
      )}

      {/* Header */}
      <div className={`p-3 text-white text-center relative flex flex-col items-center justify-center min-h-[84px] shrink-0 transition-colors ${
        p.package_type === 'wallet' ? 'bg-[#002855]' : 'bg-[#003164]'
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          {p.package_type === 'wallet' ? (
            <span className="text-[9px] bg-cyan-500/25 text-cyan-200 border border-cyan-400/40 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider flex items-center gap-1">
              <Wallet size={10} /> Wallet Package
            </span>
          ) : (
            <span className="text-[9px] bg-emerald-500/25 text-emerald-200 border border-emerald-400/40 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider flex items-center gap-1">
              <Database size={10} /> GB Package
            </span>
          )}
        </div>

        {(user?.role === 'admin' || (p.package_type !== 'wallet' && p.created_by === user?.id)) && (
          <button
            onClick={() => onEdit(p)}
            className="absolute top-2 right-2 text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-all"
            title="Edit Package"
          >
            <Pencil size={13} />
          </button>
        )}

        <div className="font-extrabold text-base tracking-wide truncate max-w-[85%]">{p.name}</div>
        <div className="text-xs text-slate-200 mt-1 font-semibold">{rs(p.selling_price)} / Voucher</div>
        <div className="text-[10px] text-slate-300 mt-0.5 flex gap-2">
          <span>{p.data_gb ? `${p.data_gb} GB` : '—'}</span>
          <span>·</span>
          <span>{p.validity_days ? `${p.validity_days} Days` : '—'}</span>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 flex-1 space-y-2.5 flex flex-col justify-between">
        <div className="space-y-2">
          {/* Quantity */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-500">No of Voucher :</span>
            <input
              type="text"
              className="border border-[#005FA3]/30 rounded-lg px-2.5 py-1 text-sm text-[#003164] w-36 text-center font-bold outline-none focus:border-primary"
              value={quantity}
              onChange={(e) => {
                const val = e.target.value
                if (val === '') {
                  setQuantity('')
                  return
                }
                if (/^\d+$/.test(val)) {
                  setQuantity(parseInt(val, 10))
                }
              }}
            />
          </div>

          {/* Batch Code */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-500">Batch ID :</span>
            <input
              type="text"
              className="border border-[#005FA3]/30 rounded-lg px-2.5 py-1 text-sm text-[#003164] w-36 text-center font-mono font-bold outline-none focus:border-primary"
              value={batchCode}
              onChange={(e) => setBatchCode(e.target.value)}
            />
          </div>

        </div>

        {/* Dynamic Balance & Warning alerts */}
        <div className="pt-2 border-t border-slate-100">
          <div className="flex justify-between items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1 bg-slate-50 text-slate-500 rounded-lg border border-slate-200/50">
              Required: <span className="text-slate-800">{isWallet ? rs(totalWalletCost) : gb(totalGbRequired)}</span>
            </span>
            <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${
              isShort
                ? 'bg-rose-50 text-rose-600 border-rose-100'
                : 'bg-emerald-50 text-emerald-600 border-emerald-100/50'
            }`}>
              Available: <span className={isShort ? 'text-rose-800' : 'text-emerald-800'}>{isWallet ? rs(targetWalletBalance) : gb(targetGbBalance)}</span>
            </span>
          </div>

          {isShort && (
            <div className="mt-2 text-[10px] text-rose-500 font-bold flex items-center justify-center gap-1 bg-rose-50 py-1 rounded-lg border border-rose-100">
              <AlertTriangle size={10} /> {isWallet ? 'Insufficient Wallet Balance' : 'Insufficient GB Balance'}
            </div>
          )}
          {err && (
            <div className="mt-2 text-[10px] text-rose-500 font-bold text-center bg-rose-50 py-1 rounded-lg border border-rose-100 max-w-full truncate">
              {err}
            </div>
          )}
        </div>
      </div>

      {/* Generate Footer Action button */}
      <button
        onClick={handlePrint}
        disabled={busy || isShort}
        className="bg-[#005FA3] hover:bg-[#004C83] disabled:bg-slate-200 disabled:text-slate-400 text-white font-extrabold py-2.5 text-center transition-all flex items-center justify-center gap-2 cursor-pointer border-t border-[#005FA3]/10 text-sm select-none"
      >
        <Sparkles size={15} /> Generate Vouchers
      </button>
    </div>
  )
}

interface VoucherGenerateTabProps {
  plans: any[]
  plansLoading?: boolean
  refetchPlans: () => void
  onSuccess?: () => void
}

export default function VoucherGenerateTab({ plans, plansLoading = false, refetchPlans, onSuccess }: VoucherGenerateTabProps) {
  const { user, refresh } = useAuth()

  // Configuration resources
  const [bandwidths, setBandwidths] = useState<any[]>([])
  const [cardTemplate, setCardTemplate] = useState<CardTemplate | null>(null)

  // Users lists for delegation
  const [allResellers, setAllResellers] = useState<any[]>([])
  const [allSellers, setAllSellers] = useState<any[]>([])

  useEffect(() => {
    api.get('/bandwidths').then((r) => setBandwidths(r.data.data))
    api.get('/voucher-template').then((r) => setCardTemplate(r.data.data))
  }, [])

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

  const canDelegate = user?.role === 'admin' || user?.role === 'reseller'

  // Delegation Options mapping
  const delegationOptions = useMemo(() => {
    const opts: SelectOption[] = [{ value: '', label: 'Myself' }]
    if (user?.role === 'admin' || user?.role === 'reseller') {
      allResellers.filter((r) => r.id !== user?.id).forEach((r) => {
        opts.push({
          value: `reseller-${r.id}`,
          label: r.name,
          badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
        })
      })
    }
    allSellers.forEach((s) => {
      opts.push({
        value: `seller-${s.id}`,
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers, user])

  // Options for the main page Generate Packages for filter
  const ownerFilterOptions = useMemo(() => {
    const opts: SelectOption[] = []
    if (user?.role === 'admin') {
      opts.push({
        value: '',
        label: 'Admin Direct (Myself)',
        badge: <span className="text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-0.5 rounded-full border border-blue-100/50">Admin</span>
      })
    } else {
      opts.push({ value: '', label: 'Myself' })
    }
    if (user?.role === 'admin' || user?.role === 'reseller') {
      allResellers.filter((r) => r.id !== user?.id).forEach((r) => {
        opts.push({
          value: `reseller-${r.id}`,
          label: r.name,
          badge: <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-2 py-0.5 rounded-full border border-purple-100/50">Reseller</span>
        })
      })
    }
    allSellers.forEach((s) => {
      opts.push({
        value: `seller-${s.id}`,
        label: s.name,
        badge: <span className="text-[10px] bg-amber-50 text-amber-600 font-bold px-2 py-0.5 rounded-full border border-amber-100/50">Seller</span>
      })
    })
    return opts
  }, [allResellers, allSellers, user])

  const [selectedOwnerId, setSelectedOwnerId] = useState('')
  const [packageTypeTab, setPackageTypeTab] = useState<'all' | 'gb' | 'wallet'>('all')

  // Filter plans to show packages created by the selected owner + Admin global wallet packages
  const ownerFilteredPackages = useMemo(() => {
    const isSellerTarget = user?.role === 'seller' || selectedOwnerId.startsWith('seller-')

    return plans.filter((p) => {
      // Wallet packages are NEVER accessible to sellers or when viewing seller packages
      if (p.package_type === 'wallet') {
        if (isSellerTarget) return false
        if (!p.creator || p.creator.role === 'admin') {
          return user?.role === 'admin' || user?.role === 'reseller'
        }
      }

      if (selectedOwnerId === 'all') return true
      if (!selectedOwnerId) {
        return p.created_by === user?.id || !p.created_by
      } else {
        const [, idStr] = selectedOwnerId.split('-')
        return p.created_by === +idStr
      }
    })
  }, [plans, selectedOwnerId, user])

  // Count package types
  const gbCount = useMemo(() => ownerFilteredPackages.filter((p) => p.package_type === 'gb').length, [ownerFilteredPackages])
  const walletCount = useMemo(() => ownerFilteredPackages.filter((p) => p.package_type === 'wallet').length, [ownerFilteredPackages])

  const [packageSearch, setPackageSearch] = useState('')

  // Apply category sub-tab filter, then the free-text package filter. The tab
  // counts above stay on the unsearched set so typing narrows the grid without
  // making the tab labels flicker.
  const displayedPackages = useMemo(() => {
    let list = ownerFilteredPackages
    if (packageTypeTab === 'gb') {
      list = list.filter((p) => p.package_type === 'gb')
    } else if (packageTypeTab === 'wallet') {
      list = list.filter((p) => p.package_type === 'wallet')
    }
    const q = packageSearch.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => (p.name || '').toLowerCase().includes(q))
    }
    return list
  }, [ownerFilteredPackages, packageTypeTab, packageSearch])

  // Create Package State
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [newPlan, setNewPlan] = useState<any>({
    name: '',
    data_gb: '',
    bandwidth_id: '',
    validity_days: '',
    selling_price: '',
    base_price: '',
    delegation_id: ''
  })

  // Edit Package State
  const [editingPlan, setEditingPlan] = useState<any>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [editForm, setEditForm] = useState<any>({
    name: '',
    data_gb: '',
    bandwidth_id: '',
    validity_days: '',
    selling_price: '',
    base_price: '',
    delegation_id: ''
  })

  // Success Modal State
  const [successResult, setSuccessResult] = useState<any>(null)
  const [successPlan, setSuccessPlan] = useState<any>(null)
  const [progress, setProgress] = useState(0)
  const [loadingAction, setLoadingAction] = useState(false)

  // Open helper for print cards
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

  const openCreateModal = () => {
    setNewPlan({
      name: '',
      data_gb: '',
      bandwidth_id: '',
      validity_days: '',
      selling_price: '',
      base_price: '',
      delegation_id: selectedOwnerId === 'all' ? '' : selectedOwnerId
    })
    setCreateErr('')
    setCreateBusy(false)
    setCreateModalOpen(true)
  }

  // Handle Create Submit
  const handleCreatePackage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlan.name || !newPlan.data_gb || !newPlan.selling_price) {
      setCreateErr('Name, Data Limit, and Retail Price are required.')
      return
    }
    setCreateBusy(true)
    setCreateErr('')
    try {
      const payload: any = {
        via_voucher: true,
        name: newPlan.name,
        type: 'hotspot',
        plan_type: 'data',
        bandwidth_id: newPlan.bandwidth_id || null,
        data_gb: +newPlan.data_gb,
        validity_days: +newPlan.validity_days || 30,
        base_price: +newPlan.base_price || 0,
        selling_price: +newPlan.selling_price || 0,
        status: 'active'
      }

      if (newPlan.delegation_id) {
        if (newPlan.delegation_id.startsWith('seller-')) {
          payload.owner_id = +newPlan.delegation_id.replace('seller-', '')
        } else if (newPlan.delegation_id.startsWith('reseller-')) {
          payload.owner_id = +newPlan.delegation_id.replace('reseller-', '')
        }
      }

      await api.post('/plans', payload)
      refetchPlans()
      setCreateModalOpen(false)
      setNewPlan({
        name: '', data_gb: '', bandwidth_id: '', validity_days: '', selling_price: '', base_price: '', delegation_id: ''
      })
    } catch (err) {
      setCreateErr(apiError(err))
    } finally {
      setCreateBusy(false)
    }
  }

  // Open Edit package Form
  const openEditModal = (plan: any) => {
    setEditingPlan(plan)
    setEditForm({
      name: plan.name,
      data_gb: plan.data_gb || '',
      bandwidth_id: plan.bandwidth_id || '',
      validity_days: plan.validity_days || '',
      selling_price: plan.selling_price || '',
      base_price: plan.base_price || '',
      delegation_id: plan.creator ? `${plan.creator.role}-${plan.creator.id}` : ''
    })
    setEditErr('')
    setEditBusy(false)
  }

  // Handle Edit Submit
  const handleEditPackage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingPlan) return
    setEditBusy(true)
    setEditErr('')
    try {
      const payload: any = {
        via_voucher: true,
        name: editForm.name,
        type: 'hotspot',
        plan_type: 'data',
        bandwidth_id: editForm.bandwidth_id || null,
        data_gb: +editForm.data_gb || null,
        validity_days: +editForm.validity_days || null,
        selling_price: +editForm.selling_price || 0,
        base_price: +editForm.base_price || 0,
        status: 'active'
      }

      if (editForm.delegation_id) {
        if (editForm.delegation_id.startsWith('seller-')) {
          payload.owner_id = +editForm.delegation_id.replace('seller-', '')
        } else if (editForm.delegation_id.startsWith('reseller-')) {
          payload.owner_id = +editForm.delegation_id.replace('reseller-', '')
        }
      }

      await api.put(`/plans/${editingPlan.id}`, payload)
      refetchPlans()
      setEditingPlan(null)
    } catch (err) {
      setEditErr(apiError(err))
    } finally {
      setEditBusy(false)
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false)

  // Handle Delete Package
  const handleDeletePackage = () => {
    if (!editingPlan) return
    setConfirmDelete(true)
  }

  const executeDeletePackage = async () => {
    if (!editingPlan) return
    setEditBusy(true)
    setEditErr('')
    try {
      await api.delete(`/plans/${editingPlan.id}`)
      refetchPlans()
      setEditingPlan(null)
      setConfirmDelete(false)
    } catch (err) {
      setEditErr(apiError(err))
      setConfirmDelete(false)
    } finally {
      setEditBusy(false)
    }
  }

  // Handle Card Generation success
  const handleGenerationSuccess = (resData: any, planObj: any) => {
    setSuccessPlan(planObj)
    setSuccessResult(resData)
    onSuccess?.()
  }

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap ${user?.role === 'seller' ? 'justify-end' : 'justify-between'} items-center gap-4 mb-2`}>
        {user?.role !== 'seller' && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-[#003164] whitespace-nowrap">Generate Packages for:</span>
            <CustomSelect
              value={selectedOwnerId}
              onChange={(val) => setSelectedOwnerId(val)}
              options={ownerFilterOptions}
              placeholder="Select Account / Reseller / Seller"
              searchable={true}
              className="min-w-[340px]"
            />
          </div>
        )}
        <button
          onClick={openCreateModal}
          className="btn-primary flex items-center gap-2 py-2 px-4 rounded-xl font-bold shadow-sm"
        >
          <Plus size={16} /> Create a Package
        </button>
      </div>



      {/* Category Sub-Tabs (Differentiate GB vs Wallet packages) + package filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3 -mt-2">
        <div className="flex flex-wrap gap-2">
          {walletCount > 0 && (
          <>
          <button
            onClick={() => setPackageTypeTab('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer select-none ${
              packageTypeTab === 'all'
                ? 'bg-[#003164] text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Layers size={13} /> All Packages ({ownerFilteredPackages.length})
          </button>

          <button
            onClick={() => setPackageTypeTab('gb')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer select-none ${
              packageTypeTab === 'gb'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60'
            }`}
          >
            <Database size={13} /> GB Packages ({gbCount})
          </button>

          <button
            onClick={() => setPackageTypeTab('wallet')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer select-none ${
              packageTypeTab === 'wallet'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-200/60'
            }`}
          >
            <Wallet size={13} /> Wallet Packages ({walletCount})
          </button>
          </>
          )}
        </div>

        <div className="relative w-full sm:w-64">
          <span className="absolute inset-y-0 left-3 flex items-center text-slate-400 pointer-events-none">
            <Search size={15} />
          </span>
          <input
            className="input pl-9 pr-8"
            placeholder="Filter packages..."
            value={packageSearch}
            onChange={(e) => setPackageSearch(e.target.value)}
          />
          {packageSearch && (
            <button
              type="button"
              onClick={() => setPackageSearch('')}
              className="absolute inset-y-0 right-2 flex items-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              title="Clear filter"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Card Grid Layout */}
      {plansLoading ? (
        <Spinner />
      ) : (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {displayedPackages.map((p) => (
          <VoucherPackageCard
            key={p.id}
            p={p}
            user={user}
            allResellers={allResellers}
            allSellers={allSellers}
            selectedOwnerId={selectedOwnerId}
            onEdit={openEditModal}
            onSuccess={handleGenerationSuccess}
            cardTemplate={cardTemplate}
            refreshAuth={refresh}
          />
        ))}
      </div>

      {displayedPackages.length === 0 && (
        <div className="bg-white border border-slate-200/80 rounded-[24px] p-12 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-slate-50 text-[#003164]/60 rounded-full mb-4 border border-slate-100">
            {packageSearch ? <Search size={32} /> : <Ticket size={32} />}
          </div>
          <h3 className="text-base font-bold text-slate-800 tracking-tight">
            {packageSearch
              ? 'No Matching Packages'
              : user?.role === 'admin' && !selectedOwnerId ? 'Select a Reseller / Seller' : 'No Custom Packages Found'}
          </h3>
          <p className="text-xs text-slate-400 font-medium max-w-sm mt-1 mb-2">
            {packageSearch
              ? `Nothing matches “${packageSearch}”. Try a different name or clear the filter.`
              : user?.role === 'admin' && !selectedOwnerId
                ? 'Packages are generated for a reseller or seller. Pick one above to see their packages.'
                : user?.role === 'seller'
                  ? 'You do not have any custom packages configured yet.'
                  : 'There are no custom packages created for this user yet. Click "Create a Package" to get started.'}
          </p>
          {packageSearch && (
            <button onClick={() => setPackageSearch('')} className="text-xs font-bold text-primary hover:underline cursor-pointer">
              Clear filter
            </button>
          )}
        </div>
      )}
      </>
      )}

      {/* Create Package Modal */}
      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Custom Package Configuration">
        <form onSubmit={handleCreatePackage} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {canDelegate && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">Plan Owner/Creator</label>
                <CustomSelect
                  value={newPlan.delegation_id}
                  onChange={(val) => setNewPlan({ ...newPlan, delegation_id: val })}
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
                value={newPlan.name}
                onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })}
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
                disabled={true}
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
                value={newPlan.data_gb}
                onChange={(e) => setNewPlan({ ...newPlan, data_gb: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1.5 block">Bandwidth Speed</label>
              <CustomSelect
                value={newPlan.bandwidth_id}
                onChange={(val) => setNewPlan({ ...newPlan, bandwidth_id: val })}
                options={[
                  { value: '', label: 'No speed limit' },
                  ...bandwidths.map((b) => ({ value: String(b.id), label: b.name }))
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
                value={newPlan.validity_days}
                onChange={(e) => setNewPlan({ ...newPlan, validity_days: e.target.value })}
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
                value={newPlan.selling_price}
                onChange={(e) => setNewPlan({ ...newPlan, selling_price: e.target.value })}
              />
            </div>
          </div>



          {createErr && <div className="pill danger w-full justify-center py-2">{createErr}</div>}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 mt-5">
            <button
              type="button"
              className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2 px-5 rounded-xl font-bold"
              onClick={() => setCreateModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createBusy}
              className="btn-primary py-2 px-5 rounded-xl font-bold flex items-center gap-1.5"
            >
              {createBusy ? 'Creating...' : 'Create Package'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Package Modal */}
      <Modal open={!!editingPlan} onClose={() => setEditingPlan(null)} title={`Edit Package: ${editingPlan?.name}`}>
        <form onSubmit={handleEditPackage} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {canDelegate && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1.5 block">Plan Owner/Creator</label>
                <CustomSelect
                  value={editForm.delegation_id}
                  onChange={(val) => setEditForm({ ...editForm, delegation_id: val })}
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
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
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
                disabled={true}
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
                value={editForm.data_gb}
                onChange={(e) => setEditForm({ ...editForm, data_gb: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1.5 block">Bandwidth Speed</label>
              <CustomSelect
                value={editForm.bandwidth_id}
                onChange={(val) => setEditForm({ ...editForm, bandwidth_id: val })}
                options={[
                  { value: '', label: 'No speed limit' },
                  ...bandwidths.map((b) => ({ value: String(b.id), label: b.name }))
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
                value={editForm.validity_days}
                onChange={(e) => setEditForm({ ...editForm, validity_days: e.target.value })}
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
                value={editForm.selling_price}
                onChange={(e) => setEditForm({ ...editForm, selling_price: e.target.value })}
              />
            </div>
          </div>



          {editErr && <div className="pill danger w-full justify-center py-2">{editErr}</div>}

          <div className="flex justify-between items-center pt-4 border-t border-slate-100 mt-5">
            <button
              type="button"
              disabled={editBusy}
              onClick={handleDeletePackage}
              className="px-4 py-2 text-xs font-bold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete Package
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2 px-5 rounded-xl font-bold"
                onClick={() => setEditingPlan(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editBusy}
                className="btn-primary py-2 px-5 rounded-xl font-bold flex items-center gap-1.5"
              >
                {editBusy ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Success Modal */}
      <Modal
        open={!!successResult}
        onClose={() => setSuccessResult(null)}
        title="Voucher Batch Generated"
        widthClassName="max-w-3xl"
      >
        {successResult && (
          <div className="space-y-5">
            <div className="bg-emerald-50 border border-emerald-100/60 rounded-2xl px-5 py-4 flex items-center gap-3">
              <Ticket className="text-emerald-500 shrink-0" size={28} />
              <div>
                <p className="font-extrabold text-emerald-800">{successResult.message}</p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  Batch <span className="font-mono font-bold bg-white/70 px-1.5 py-0.5 rounded-lg border border-emerald-100">{successResult.batch_code}</span> · {successResult.quantity} voucher(s) · {successResult.plan}
                </p>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">Preview (first {successResult.sample?.length})</p>
              <div className="flex gap-4 overflow-x-auto pb-3">
                {cardTemplate && successResult.sample?.map((code: string) => (
                  <VoucherCard
                    key={code}
                    code={code}
                    planName={successResult.plan}
                    price={successPlan?.selling_price}
                    size={200}
                    template={cardTemplate}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-3 border-t border-slate-100">
              <button
                className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2 px-5 rounded-xl font-bold flex items-center gap-2"
                onClick={() => openBlob('/vouchers/print', { batch: successResult.batch_code })}
              >
                <Printer size={15} /> Print All Cards
              </button>
              <button className="btn-primary py-2 px-5 rounded-xl font-bold" onClick={() => setSuccessResult(null)}>Done</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Progress Bar Overlay */}
      {loadingAction && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/45 backdrop-blur-sm select-none animate-fade-in">
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

      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={executeDeletePackage}
        title="Delete Package"
        message={`Are you sure you want to delete the package "${editingPlan?.name}"?`}
        confirmText="Delete Package"
      />
    </div>
  )
}
