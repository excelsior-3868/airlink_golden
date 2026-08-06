import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, CheckCircle, Image as ImageIcon, Plus, Trash2, RotateCcw, Palette, Users as Users2, UserCheck, ShieldCheck } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { GlassCard, PageTitle, EmptyState, Spinner, CustomSelect, SelectOption, ConfirmModal } from '../components/ui'
import { CardElement, CardTemplate } from '../components/VoucherCard'

const CANVAS_W = 640

// Sample values used only for the live preview.
const SAMPLE = { code: '2AA0E9', price: 1500, planName: 'Monthly_staff_package', username: '2AA0E9', password: '2AA0E9' }

const FIELD_LABELS: Record<CardElement['field'], string> = {
  text: 'Static Text',
  code: 'Voucher Code',
  price: 'Price',
  plan_name: 'Plan Name',
  username: 'Username',
  password: 'Password',
  image: 'Logo / Image',
}

// Content types offered in the element editor dropdown (image is added via its own button).
const TEXT_FIELDS: CardElement['field'][] = ['text', 'code', 'price', 'plan_name', 'username', 'password']

function resolvePreview(el: CardElement): string {
  switch (el.field) {
    case 'price': return `Rs. ${SAMPLE.price.toLocaleString()}`
    case 'code': return SAMPLE.code
    case 'plan_name': return SAMPLE.planName
    case 'username': return SAMPLE.username
    case 'password': return SAMPLE.password
    default: return el.text || 'Text'
  }
}

export default function VoucherCardDesigner() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // Admin-only: list of resellers + sellers to design for.
  const [users, setUsers] = useState<{ id: number; name: string; username: string; role: string }[]>([])
  const [targetUserId, setTargetUserId] = useState<number | null>(null)
  const targetUser = users.find((u) => u.id === targetUserId) || null

  const [tpl, setTpl] = useState<CardTemplate | null>(null)
  const [isCustom, setIsCustom] = useState(false)
  const [reverting, setReverting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [confirmRevert, setConfirmRevert] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  // Fetch full user list for admin once on mount.
  useEffect(() => {
    if (!isAdmin) return
    api.get('/users', { params: { per_page: 200 } })
      .then((r) => setUsers((r.data.data?.data ?? r.data.data ?? []).filter((u: any) => u.role !== 'admin')))
      .catch(() => {})
  }, [isAdmin])

  // Load template whenever the target user changes.
  useEffect(() => {
    setLoading(true)
    setTpl(null)
    setSelectedId(null)
    setErr('')
    setMsg('')
    const params = targetUserId ? { user_id: targetUserId } : {}
    api.get('/voucher-template', { params })
      .then((r) => {
        setTpl(r.data.data)
        setIsCustom(!!r.data.data.is_custom)
      })
      .catch((e) => setErr(apiError(e)))
      .finally(() => setLoading(false))
  }, [targetUserId])

  const selected = tpl?.elements.find((e) => e.id === selectedId) || null

  const patch = (changes: Partial<CardTemplate>) => setTpl((t) => (t ? { ...t, ...changes } : t))
  const patchEl = (id: string, changes: Partial<CardElement>) =>
    setTpl((t) => (t ? { ...t, elements: t.elements.map((e) => (e.id === id ? { ...e, ...changes } : e)) } : t))

  // ── Dragging ──
  const onDown = (e: React.MouseEvent, el: CardElement) => {
    e.preventDefault()
    setSelectedId(el.id)
    const rect = canvasRef.current!.getBoundingClientRect()
    const elX = (el.x / 100) * rect.width
    const elY = (el.y / 100) * rect.height
    drag.current = { id: el.id, dx: e.clientX - rect.left - elX, dy: e.clientY - rect.top - elY }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current || !canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left - drag.current.dx) / rect.width) * 100
      const y = ((e.clientY - rect.top - drag.current.dy) / rect.height) * 100
      patchEl(drag.current.id, { x: Math.max(0, Math.min(100, +x.toFixed(2))), y: Math.max(0, Math.min(100, +y.toFixed(2))) })
    }
    const onUp = () => { drag.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const addElement = () => {
    const id = `el${Date.now().toString(36)}`
    const el: CardElement = {
      id, field: 'text', text: 'New Text', x: 40, y: 45, font_size: 16,
      color: '#ffffff', weight: 700, align: 'left', underline: false, letter_spacing: 0, font: 'sans', shadow: true,
    }
    patch({ elements: [...(tpl?.elements || []), el] })
    setSelectedId(id)
  }

  const addLogo = (file: File) => {
    if (file.size > 4 * 1024 * 1024) { setErr('Logo too large (max 4MB).'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const id = `img${Date.now().toString(36)}`
      const el: CardElement = {
        id, field: 'image', image_data: reader.result as string, x: 78, y: 8, width: 18,
        font_size: 16, color: '#ffffff', weight: 400, align: 'left', font: 'sans', shadow: false,
      }
      patch({ elements: [...(tpl?.elements || []), el] })
      setSelectedId(id)
    }
    reader.readAsDataURL(file)
  }

  const removeElement = (id: string) => {
    patch({ elements: (tpl?.elements || []).filter((e) => e.id !== id) })
    if (selectedId === id) setSelectedId(null)
  }

  const uploadBg = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setErr('Image too large (max 10MB).'); return }
    const reader = new FileReader()
    reader.onload = () => patch({ background_data: reader.result as string })
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!tpl) return
    setSaving(true); setErr(''); setMsg('')
    try {
      const payload: any = { ...tpl }
      // When admin is designing for a specific user, include target_user_id.
      if (isAdmin && targetUserId) payload.target_user_id = targetUserId
      await api.post('/voucher-template', payload)
      setMsg('Voucher card design saved.')
      const params = targetUserId ? { user_id: targetUserId } : {}
      const r = await api.get('/voucher-template', { params })
      setTpl(r.data.data)
      setIsCustom(!!r.data.data.is_custom)
    } catch (e) { setErr(apiError(e)) } finally { setSaving(false) }
  }

  const revertToDefault = () => setConfirmRevert(true)

  const executeRevertToDefault = async () => {
    setReverting(true); setErr(''); setMsg('')
    try {
      const params = isAdmin && targetUserId ? { user_id: targetUserId } : {}
      await api.delete('/voucher-template', { params })
      setMsg('Custom design removed. Reverted to default template.')
      const getParams = targetUserId ? { user_id: targetUserId } : {}
      const r = await api.get('/voucher-template', { params: getParams })
      setTpl(r.data.data)
      setIsCustom(!!r.data.data.is_custom)
      setSelectedId(null)
    } catch (e) { setErr(apiError(e)) } finally { setReverting(false) }
  }

  if (loading) return <Spinner />
  if (!tpl) return <EmptyState>{err || 'Failed to load template.'}</EmptyState>

  const scale = CANVAS_W / tpl.width
  const canvasH = Math.round(CANVAS_W * (tpl.height / tpl.width))
  const bg = tpl.background_data || '/voucher-card-bg.png'

  // Flat list sorted by name — role shown as a badge on the right, no username or grouping.
  const userOptions: SelectOption[] = [
    { value: '', label: 'Default Design (All Users)' },
    ...[...users]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(u => ({
        value: u.id,
        label: u.name,
        badge: (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
            u.role === 'reseller'
              ? 'bg-violet-100 text-violet-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {u.role === 'reseller' ? 'Reseller' : 'Seller'}
          </span>
        ),
      })),
  ]

  const designingForLabel = targetUser
    ? `${targetUser.name} (${targetUser.role === 'reseller' ? 'Reseller' : 'Seller'})`
    : isAdmin ? 'Default (All Users)' : ''

  return (
    <div>
      <PageTitle
        title="Voucher Card Designer"
        subtitle={targetUser ? `Designing for: ${designingForLabel}` : 'Upload artwork, drag text into place, and set the card size'}
        icon={<Palette size={22} className="text-rose-600" />}
        action={
          <div className="flex items-center gap-2">
            {/* Revert button: admin can revert a user's custom, non-admin can revert own */}
            {((!isAdmin && isCustom) || (isAdmin && targetUserId && isCustom)) && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="btn-ghost !border-rose-200 !text-rose-600 hover:!bg-rose-50 flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-normal"
                disabled={saving || reverting}
                onClick={revertToDefault}
              >
                {reverting
                  ? <span className="h-4 w-4 rounded-full border-2 border-rose-200 border-t-rose-600 animate-spin shrink-0" />
                  : <RotateCcw size={16} />}
                Revert to Default
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="btn-primary flex items-center gap-2 py-2 px-4 rounded-xl text-xs font-normal"
              disabled={saving || reverting}
              onClick={save}
            >
              {saving
                ? <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin shrink-0" />
                : <Save size={16} />}
              Save Design
            </motion.button>
          </div>
        }
      />

      {/* ── Admin: design on behalf of a user ── */}
      {isAdmin && (
        <div className="mb-5 p-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-blue-700">
            <ShieldCheck size={18} />
            <span className="text-sm font-semibold">Admin Design Mode</span>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <Users2 size={15} className="text-slate-400 shrink-0" />
            <span className="text-xs text-slate-500 whitespace-nowrap">Designing for:</span>
            <CustomSelect
              className="flex-1"
              value={targetUserId ?? ''}
              onChange={(val) => setTargetUserId(val === '' ? null : Number(val))}
              options={userOptions}
              placeholder="Default Design (All Users)"
              searchable
            />
          </div>
          {targetUser && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-100 rounded-lg px-3 py-1.5">
              <UserCheck size={13} />
              <span>{isCustom ? 'Has custom design' : 'Using default design'}</span>
            </div>
          )}
        </div>
      )}

      {msg && <div className="mb-4 p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl flex items-center gap-2 text-sm font-semibold"><CheckCircle size={16} /> {msg}</div>}
      {err && <div className="mb-4 p-3 bg-rose-50 text-rose-800 border border-rose-200 rounded-xl text-sm font-semibold">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[auto_360px] gap-5">
        {/* ── Canvas ── */}
        <GlassCard>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2 px-4 rounded-xl font-bold flex items-center gap-2 cursor-pointer text-sm">
              <ImageIcon size={15} /> Upload Background
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadBg(e.target.files[0])} />
            </label>
            {tpl.background_data && (
              <button className="btn-ghost !border-slate-200 !text-slate-600 hover:!bg-slate-50 py-2 px-4 rounded-xl font-bold flex items-center gap-2 text-sm" onClick={() => patch({ background_data: null })}>
                <RotateCcw size={14} /> Use Default Artwork
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto text-sm">
              <span className="text-xs font-bold text-slate-500">Size</span>
              <input type="number" min={120} max={2000} className="input !w-20 !py-1.5" value={tpl.width} onChange={(e) => patch({ width: +e.target.value || 1 })} />
              <span className="text-slate-400">×</span>
              <input type="number" min={80} max={2000} className="input !w-20 !py-1.5" value={tpl.height} onChange={(e) => patch({ height: +e.target.value || 1 })} />
              <span className="text-xs text-slate-400">px</span>
            </div>
          </div>

          <div
            ref={canvasRef}
            className="relative rounded-xl overflow-hidden shadow-lg mx-auto"
            style={{ width: CANVAS_W, height: canvasH, backgroundImage: `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center', maxWidth: '100%' }}
            onMouseDown={(e) => { if (e.target === canvasRef.current) setSelectedId(null) }}
          >
            {tpl.elements.map((el) => {
              const translateX = el.align === 'right' ? '-100%' : el.align === 'center' ? '-50%' : '0'
              const outline = selectedId === el.id ? '2px solid #2563eb' : '1px dashed rgba(255,255,255,0.4)'

              if (el.field === 'image') {
                return (
                  <img
                    key={el.id}
                    src={el.image_data}
                    alt=""
                    draggable={false}
                    onMouseDown={(e) => onDown(e, el)}
                    style={{
                      position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, transform: `translateX(${translateX})`,
                      width: ((el.width || 20) / 100) * CANVAS_W, height: 'auto', cursor: 'move',
                      filter: el.shadow ? 'drop-shadow(0 1px 4px rgba(0,0,0,0.45))' : 'none',
                      outline, outlineOffset: 2,
                    }}
                  />
                )
              }

              return (
                <div
                  key={el.id}
                  onMouseDown={(e) => onDown(e, el)}
                  style={{
                    position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, transform: `translateX(${translateX})`,
                    whiteSpace: 'nowrap', cursor: 'move', fontSize: el.font_size * scale, color: el.color,
                    fontWeight: el.weight, textAlign: el.align, textDecoration: el.underline ? 'underline' : 'none',
                    letterSpacing: (el.letter_spacing || 0) * scale, fontFamily: el.font === 'mono' ? 'monospace' : 'sans-serif',
                    lineHeight: 1.1, textShadow: el.shadow ? '0 1px 4px rgba(0,0,0,0.45)' : 'none',
                    outline, outlineOffset: 2, borderRadius: 2, padding: '0 1px',
                  }}
                >
                  {resolvePreview(el)}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-slate-400 text-center mt-3">Click an element to edit it · drag to reposition · preview uses sample data</p>
        </GlassCard>

        {/* ── Properties panel ── */}
        <div className="space-y-4">
          <GlassCard className="!p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-sm text-slate-700">Elements</h3>
              <div className="flex items-center gap-1.5">
                <label className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 !py-1.5 !px-3 text-xs flex items-center gap-1 cursor-pointer rounded-lg">
                  <ImageIcon size={13} /> Logo
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addLogo(e.target.files[0])} />
                </label>
                <button className="btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1" onClick={addElement}><Plus size={13} /> Text</button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {tpl.elements.map((el) => (
                <button
                  key={el.id}
                  onClick={() => setSelectedId(el.id)}
                  className={`flex items-center justify-between text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedId === el.id ? 'bg-primary/10 text-primary font-bold' : 'hover:bg-slate-50 text-slate-600'}`}
                >
                  <span className="truncate">{FIELD_LABELS[el.field]}{el.field === 'text' && el.text ? `: ${el.text}` : ''}</span>
                  <Trash2 size={13} className="text-slate-400 hover:text-rose-500 shrink-0" onClick={(ev) => { ev.stopPropagation(); removeElement(el.id) }} />
                </button>
              ))}
            </div>
          </GlassCard>

          {selected ? (
            <GlassCard className="!p-4 space-y-3">
              <h3 className="font-bold text-sm text-slate-700">Edit Element</h3>

              {selected.field === 'image' ? (
                <>
                  <label className="btn-ghost !border-slate-200 !text-slate-700 hover:!bg-slate-50 py-2 px-4 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer text-sm">
                    <ImageIcon size={14} /> Replace Image
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && addLogo(e.target.files[0])} />
                  </label>
                  <div>
                    <label className="text-xs font-bold text-slate-500">Width (% of card)</label>
                    <input type="number" min={1} max={100} step={0.5} className="input mt-1" value={selected.width || 20} onChange={(e) => patchEl(selected.id, { width: +e.target.value || 1 })} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-bold text-slate-500">Content</label>
                    <select className="input mt-1" value={selected.field} onChange={(e) => patchEl(selected.id, { field: e.target.value as CardElement['field'] })}>
                      {TEXT_FIELDS.map((k) => <option key={k} value={k}>{FIELD_LABELS[k]}</option>)}
                    </select>
                  </div>

                  {selected.field === 'text' && (
                    <div>
                      <label className="text-xs font-bold text-slate-500">Text</label>
                      <input className="input mt-1" value={selected.text || ''} onChange={(e) => patchEl(selected.id, { text: e.target.value })} />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-500">Font Size</label>
                      <input type="number" min={4} max={200} className="input mt-1" value={selected.font_size} onChange={(e) => patchEl(selected.id, { font_size: +e.target.value || 1 })} />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500">Weight</label>
                      <select className="input mt-1" value={selected.weight} onChange={(e) => patchEl(selected.id, { weight: +e.target.value })}>
                        <option value={400}>Regular</option>
                        <option value={600}>Semibold</option>
                        <option value={700}>Bold</option>
                        <option value={900}>Black</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-500">Color</label>
                      <div className="flex items-center gap-2 mt-1">
                        <input type="color" className="w-10 h-9 rounded-lg border border-slate-200 cursor-pointer" value={selected.color} onChange={(e) => patchEl(selected.id, { color: e.target.value })} />
                        <input className="input" value={selected.color} onChange={(e) => patchEl(selected.id, { color: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500">Font</label>
                      <select className="input mt-1" value={selected.font} onChange={(e) => patchEl(selected.id, { font: e.target.value as 'sans' | 'mono' })}>
                        <option value="sans">Sans-serif</option>
                        <option value="mono">Monospace</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-500">Letter Spacing</label>
                    <input type="number" min={0} max={40} step={0.5} className="input mt-1" value={selected.letter_spacing || 0} onChange={(e) => patchEl(selected.id, { letter_spacing: +e.target.value || 0 })} />
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500">Alignment</label>
                <div className="flex gap-1 mt-1">
                  {(['left', 'center', 'right'] as const).map((a) => (
                    <button key={a} onClick={() => patchEl(selected.id, { align: a })}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${selected.align === a ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{a}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500">X Position (%)</label>
                  <input type="number" min={0} max={100} step={0.5} className="input mt-1" value={selected.x} onChange={(e) => patchEl(selected.id, { x: +e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500">Y Position (%)</label>
                  <input type="number" min={0} max={100} step={0.5} className="input mt-1" value={selected.y} onChange={(e) => patchEl(selected.id, { y: +e.target.value })} />
                </div>
              </div>

              <div className="flex items-center gap-4 pt-1">
                {selected.field !== 'image' && (
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={!!selected.underline} onChange={(e) => patchEl(selected.id, { underline: e.target.checked })} /> Underline
                  </label>
                )}
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={!!selected.shadow} onChange={(e) => patchEl(selected.id, { shadow: e.target.checked })} /> Shadow
                </label>
              </div>

              <button className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 font-bold text-sm hover:bg-rose-100 transition-colors" onClick={() => removeElement(selected.id)}>
                <Trash2 size={14} /> Delete Element
              </button>
            </GlassCard>
          ) : (
            <GlassCard className="!p-4"><p className="text-sm text-slate-400 text-center py-6">Select an element to edit its style and position.</p></GlassCard>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirmRevert}
        onClose={() => setConfirmRevert(false)}
        onConfirm={executeRevertToDefault}
        title="Revert to Default Design"
        message={`Are you sure you want to revert ${targetUser ? `${targetUser.name}'s` : 'your'} custom design back to the admin default? This cannot be undone.`}
        confirmText="Revert to Default"
      />
    </div>
  )
}
