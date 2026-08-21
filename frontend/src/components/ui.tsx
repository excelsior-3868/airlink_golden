import { motion, AnimatePresence } from 'framer-motion'
import { ReactNode, useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import { Check, ChevronDown, Tag, Zap, Clock, Ban, Ticket, PlusCircle, Search, Sparkles, Wallet, Database } from 'lucide-react'
import { ComposedChart, Bar, Cell, Line, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
export { DualDatePicker } from './DualDatePicker'
export { ConfirmModal } from './ConfirmModal'
export type { ConfirmState } from './ConfirmModal'
import { OnlineUsersBadge, OnlineUsersModal } from './OnlineUsersModal'
export { OnlineUsersBadge, OnlineUsersModal } from './OnlineUsersModal'

export function GlassCard({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`glass-card p-5 sm:p-6 ${className}`} onClick={onClick}>{children}</div>
}

export function Pill({ tone = 'secondary', children, className = '' }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={`pill ${tone} ${className}`}>{children}</span>
}

export function StatCard({ label, value, icon, sub, iconColorClass = 'text-primary bg-primary/10' }: { label: string; value: ReactNode; icon?: ReactNode; sub?: ReactNode; iconColorClass?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card p-5 flex items-start justify-between"
    >
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs sm:text-sm font-medium">{label}</p>
        <p className="text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
      {icon && <div className={`rounded-2xl p-2.5 shrink-0 flex items-center justify-center ${iconColorClass}`}>{icon}</div>}
    </motion.div>
  )
}

/**
 * Two related figures stacked in one tile, split by a hairline — the shape the
 * reseller dashboard already used inline for its paired metrics (payment vs
 * receivable, commission due vs earned).
 */
export function DualStatCard({ top, bottom, className = '' }: {
  top: { label: string; value: ReactNode; icon?: ReactNode; iconColorClass?: string; valueColorClass?: string; sub?: ReactNode };
  bottom: { label: string; value: ReactNode; icon?: ReactNode; iconColorClass?: string; valueColorClass?: string; sub?: ReactNode };
  className?: string;
}) {
  const half = (s: typeof top) => (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs sm:text-sm font-medium leading-snug">{s.label}</p>
        <p className={`text-xl font-bold mt-1 tracking-tight tabular-nums whitespace-nowrap ${s.valueColorClass || ''}`}>{s.value}</p>
        {s.sub && <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>}
      </div>
      {s.icon && (
        <div className={`rounded-2xl p-2.5 shrink-0 flex items-center justify-center ${s.iconColorClass || 'text-primary bg-primary/10'}`}>
          {s.icon}
        </div>
      )}
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`glass-card p-5 flex flex-col justify-between gap-3 ${className}`}
    >
      {half(top)}
      <div className="h-px bg-slate-200" />
      {half(bottom)}
    </motion.div>
  )
}

export function VoucherStatCard({
  title,
  vouchers,
  icon,
  iconColorClass = 'text-rose-500 bg-rose-50 border border-rose-100/50',
  valueColorClass = 'text-rose-600',
  className = ''
}: {
  title: string;
  vouchers: {
    total: number;
    by_status: Record<string, number>;
    sold_today?: number;
    // Revoked stock. Sent apart from by_status so it can be shown alongside the
    // other statuses without ever being added into `total`.
    disabled?: number;
  };
  icon?: ReactNode;
  iconColorClass?: string;
  valueColorClass?: string;
  className?: string;
}) {
  const total = vouchers?.total || 0;
  const byStatus = vouchers?.by_status || {};
  const soldToday = vouchers?.sold_today;
  const disabled = vouchers?.disabled || 0;

  const statusLine = [
    { status: 'Ready', value: byStatus.ready || 0, color: '#3b82f6' },
    { status: 'Active', value: byStatus.active || 0, color: '#10b981' },
    { status: 'Used', value: byStatus.used || 0, color: '#0ea5e9' },
    { status: 'Disabled', value: disabled, color: '#f43f5e' },
  ];
  const renderStatusDot = (props: any) => {
    const { cx, cy, payload } = props;
    return <circle key={payload.status} cx={cx} cy={cy} r={3.5} fill={payload.color} stroke="white" strokeWidth={1.5} />;
  };

  // p-5 matches StatCard, which this card sits beside in every dashboard row —
  // equal padding is what puts both headings on the same baseline.
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`glass-card p-5 flex flex-col justify-between ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          {/* Title and today's tally share the heading line; the total sits below. */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-muted-foreground text-xs sm:text-sm font-medium">{title}</p>
            {soldToday !== undefined && (
              <p className="text-xs text-muted-foreground whitespace-nowrap">
                Today <strong className="text-slate-700">{soldToday.toLocaleString()}</strong> Sold
              </p>
            )}
          </div>
          <p className={`text-xl lg:text-2xl font-bold mt-0.5 tracking-tight ${valueColorClass}`}>{total.toLocaleString()}</p>
        </div>
        {icon && (
          <div className={`rounded-2xl p-2 shrink-0 flex items-center justify-center ${iconColorClass}`}>
            {icon}
          </div>
        )}
      </div>

      {/* flex-1 + a 4rem floor: identical to a fixed h-16 in an auto-height card,
          but lets the chart absorb the extra space when the card is made taller
          (e.g. row-span-2) instead of leaving a gap above the status pills. */}
      <div className="flex-1 min-h-[4rem] mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={statusLine} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
            <XAxis dataKey="status" tick={{ fontSize: 8.5, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={0} padding={{ left: 14, right: 14 }} />
            <Tooltip
              formatter={(v: any) => [v, 'Vouchers']}
              labelStyle={{ fontSize: 11, fontWeight: 600 }}
              contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 11, padding: '4px 8px' }}
              cursor={{ fill: '#f1f5f9' }}
            />
            <Bar dataKey="value" barSize={16} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {statusLine.map((entry) => (
                <Cell key={entry.status} fill={entry.color} fillOpacity={0.22} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="value" stroke="#cbd5e1" strokeWidth={2} dot={renderStatusDot} activeDot={{ r: 6 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-1">
        <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold border border-blue-100/50 shrink-0">
          {byStatus.ready || 0} Ready
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold border border-emerald-100/50 shrink-0">
          {byStatus.active || 0} Active
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold border border-amber-100/50 shrink-0">
          {byStatus.used || 0} Used
        </span>
        <span className="px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-bold border border-rose-100/50 shrink-0">
          {disabled} Disabled
        </span>
      </div>
    </motion.div>
  )
}

export function PageTitle({ title, subtitle, action, icon, showBalances = false, showOnlineUsers = false }: { title: string; subtitle?: string; action?: ReactNode; icon?: ReactNode; showBalances?: boolean; showOnlineUsers?: boolean }) {
  const { user } = useAuth()

  return (
    <div className="flex items-start justify-between mb-6 flex-wrap gap-4 pt-4">
      <div className="flex items-start gap-4">
        {icon && (
          <div className="p-3 rounded-2xl shrink-0 bg-white border border-slate-200/80 shadow-sm flex items-center justify-center">
            {icon}
          </div>
        )}
        <div className="pt-1">
          <h1 className="text-lg sm:text-2xl font-medium tracking-tight text-[#003164] flex items-center gap-2">
            {title}
          </h1>
          {subtitle && <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>}
        </div>
      </div>
      
      <div className="flex items-center gap-3 flex-wrap">
        {/* Wallet / GB balance pills and the online-users badge are independent:
            the Dashboard already shows both balances as StatCards, so it opts
            out of the pills while keeping the badge. */}
        {(showBalances || showOnlineUsers) && user && (
          <div className="hidden sm:flex items-center gap-2.5 select-none">
            {showBalances && user.role !== 'seller' && (
              <div className="flex items-center gap-2 bg-gradient-to-r from-emerald-50 to-teal-50/70 border border-emerald-200/80 rounded-2xl py-1.5 px-3.5 shadow-xs text-xs group hover:border-emerald-300 transition-all">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                  <Wallet size={13} />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] text-emerald-600 font-extrabold tracking-wide">Wallet</span>
                  <span className="font-extrabold text-emerald-950 text-xs">{rs(user.wallet_balance)}</span>
                </div>
              </div>
            )}
            {showBalances && (
              <div className="flex items-center gap-2 bg-gradient-to-r from-purple-50 to-indigo-50/70 border border-purple-200/80 rounded-2xl py-1.5 px-3.5 shadow-xs text-xs group hover:border-purple-300 transition-all">
                <div className="w-6 h-6 rounded-lg bg-purple-500/15 text-purple-600 flex items-center justify-center shrink-0">
                  <Database size={13} />
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-[10px] text-purple-600 font-extrabold tracking-wide">GB Balance</span>
                  <span className="font-extrabold text-purple-950 text-xs">{gb(user.gb_balance)}</span>
                </div>
              </div>
            )}

            {showOnlineUsers && user.role === 'admin' && (
              <OnlineUsersBadge />
            )}
          </div>
        )}
        {action}
      </div>
    </div>
  )
}

export function Pagination({ meta, onPage }: { meta: any; onPage: (p: number) => void }) {
  if (!meta) return null
  const { current_page, last_page, from, to, total } = meta
  // Laravel's paginator sends from/to, but hand-built metas (e.g. the ledger's
  // merged invoice+payment+voucher feed) only carry page/per_page/total — derive
  // the range in that case rather than reporting "Showing 0 to 0 of N".
  const perPage = meta.per_page ?? (Array.isArray(meta.data) ? meta.data.length : 0)
  const rangeStart = from ?? (total > 0 && perPage > 0 ? (current_page - 1) * perPage + 1 : 0)
  const rangeEnd = to ?? (total > 0 && perPage > 0 ? Math.min(current_page * perPage, total) : 0)
  return (
    <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
      <p className="text-xs font-semibold text-slate-500">
        Showing {rangeStart} to {rangeEnd} of {total} items
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPage(current_page - 1)}
          disabled={current_page <= 1}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Prev
        </button>
        <span className="w-8 h-8 flex items-center justify-center text-xs font-bold rounded-lg border bg-primary border-primary text-white shadow-md shadow-primary/20 scale-105">
          {current_page}
        </span>
        <span className="text-xs text-slate-400 px-1">/ {last_page}</span>
        <button
          onClick={() => onPage(current_page + 1)}
          disabled={current_page >= last_page}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Next
        </button>
      </div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  bodyClassName = 'overflow-y-auto max-h-[calc(85vh-8rem)]',
  widthClassName = 'max-w-2xl',
  tone = 'light'
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  widthClassName?: string;
  tone?: 'light' | 'brand';
}) {
  const backdropMouseDown = useRef(false)
  const isBrand = tone === 'brand'
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm"
          onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget }}
          onMouseUp={(e) => { if (backdropMouseDown.current && e.target === e.currentTarget) onClose(); backdropMouseDown.current = false }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={`bg-white w-full ${widthClassName} rounded-[28px] relative shadow-2xl border border-slate-100 flex flex-col overflow-visible`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={`flex items-center justify-between p-5 sm:p-6 border-b rounded-t-[28px] select-none ${isBrand ? 'bg-[#003164] border-[#003164]' : 'bg-white border-slate-100'}`}>
              <div className="flex items-center gap-3.5 min-w-0">
                {icon && (
                  <div className={`p-3 rounded-2xl shrink-0 flex items-center justify-center shadow-sm ${isBrand ? 'bg-white/10 text-white border border-white/20' : 'bg-blue-50 text-[#003164] border border-blue-100/50'}`}>
                    {icon}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className={`text-lg font-bold tracking-tight leading-none truncate ${isBrand ? 'text-white' : 'text-slate-800'}`}>{title}</h2>
                  {subtitle && <p className={`text-xs font-semibold mt-1.5 leading-normal tracking-wide truncate max-w-lg ${isBrand ? 'text-blue-100/70' : 'text-slate-400'}`}>{subtitle}</p>}
                </div>
              </div>

              <button
                onClick={onClose}
                className={`w-8 h-8 flex items-center justify-center rounded-full border transition-all cursor-pointer shrink-0 ml-4 ${isBrand ? 'border-white/20 text-white/70 hover:text-white hover:bg-white/10' : 'border-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="text-lg font-light leading-none">&times;</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className={`p-6 sm:p-8 ${bodyClassName}`}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function EmptyState({ title, subtitle, children }: { title?: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="text-center text-slate-500 py-12 px-4">
      {children ? (
        children
      ) : (
        <>
          <p className="text-sm font-bold text-slate-700">{title || 'No Records Found'}</p>
          {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
        </>
      )}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-16 ${className}`}>
      <div className="h-9 w-9 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
    </div>
  )
}

export interface SelectOption {
  value: any;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
  group?: string;  // Optional group label for rendering section headers.
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  className = '',
  disabled = false,
  searchable = false
}: {
  value: any;
  onChange: (val: any) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, up: false })

  const updateCoords = () => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    // Flip above the trigger when the list would run past the viewport bottom
    // (common inside modals, where the field sits near the lower edge).
    const height = dropdownRef.current?.offsetHeight || 280
    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12
    const up = spaceBelow < height && spaceAbove > spaceBelow
    setCoords({
      top: up
        ? rect.top + window.scrollY - height - 6
        : rect.bottom + window.scrollY + 6,
      left: rect.left + window.scrollX,
      width: rect.width,
      up
    })
  }

  useEffect(() => {
    if (open) {
      updateCoords()
      window.addEventListener('resize', updateCoords)
      window.addEventListener('scroll', updateCoords, true)
    }
    return () => {
      window.removeEventListener('resize', updateCoords)
      window.removeEventListener('scroll', updateCoords, true)
    }
  }, [open])

  // Re-measure once the list is mounted (and whenever filtering changes its
  // height) so a flipped dropdown sits flush above the trigger.
  useLayoutEffect(() => {
    if (open) updateCoords()
  }, [open, searchQuery, options.length])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        (!dropdownRef.current || !dropdownRef.current.contains(event.target as Node))
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [open])

  useEffect(() => {
    if (!open) {
      setSearchQuery('')
    } else if (searchable) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, searchable])

  const getStatusDetails = (val: any, originalLabel: string) => {
    const s = String(val).toLowerCase();
    
    let label = originalLabel;
    if (['new', 'used', 'sold', 'active', 'expired', 'disabled'].includes(s)) {
      label = s.charAt(0).toUpperCase() + s.slice(1);
    } else if (val === '' && (originalLabel.toLowerCase() === 'all statuses' || originalLabel.toLowerCase() === 'all status')) {
      label = 'All Statuses';
    }

    let icon: ReactNode = null;
    if (s === 'new') {
      icon = <Sparkles size={14} className="text-sky-500" />;
    } else if (s === 'used') {
      icon = <PlusCircle size={14} className="text-blue-500" />;
    } else if (s === 'sold') {
      icon = <Tag size={14} className="text-amber-500" />;
    } else if (s === 'active') {
      icon = <Zap size={14} className="text-emerald-500" />;
    } else if (s === 'expired') {
      icon = <Clock size={14} className="text-rose-500" />;
    } else if (s === 'disabled') {
      icon = <Ban size={14} className="text-slate-400" />;
    } else if (val === '' && (originalLabel.toLowerCase() === 'all statuses' || originalLabel.toLowerCase() === 'all status')) {
      icon = <Ticket size={14} className="text-slate-400" />;
    }

    return { label, icon };
  };

  const resolvedOptions = options.map((opt) => {
    const details = getStatusDetails(opt.value, opt.label);
    return {
      ...opt,
      label: details.label,
      icon: opt.icon || details.icon
    };
  });

  const filteredOptions = resolvedOptions.filter((o) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return String(o.label).toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q)
  })

  const selected = resolvedOptions.find((o) => String(o.value).toUpperCase() === String(value).toUpperCase())

  return (
    <div ref={ref} className={`relative text-left ${className.includes('w-full') ? 'w-full block' : 'inline-block min-w-[180px]'} ${open ? 'z-30' : 'z-0'} ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-semibold text-slate-700 shadow-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          {selected?.icon && (
            <div className="shrink-0 flex items-center justify-center">
              {selected.icon}
            </div>
          )}
          <span className="truncate">{selected ? selected.label : placeholder}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {selected?.badge}
          <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Options Dropdown list */}
      {open && createPortal(
        <div 
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: coords.top,
            left: coords.left,
            minWidth: Math.max(coords.width, 320)
          }}
          className="bg-white border border-slate-200/80 rounded-2xl shadow-xl z-[9999] flex flex-col overflow-hidden"
        >
          {searchable && (
            <div className="p-2.5 border-b border-slate-100 bg-white z-10 flex items-center gap-1.5 shrink-0">
              <Search size={14} className="text-slate-400 shrink-0 ml-1.5" />
              <input
                ref={inputRef}
                type="text"
                className="w-full bg-transparent border-0 outline-none text-xs text-slate-700 py-1"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="flex-1 p-1.5 flex flex-col gap-0.5 max-h-52 overflow-y-auto">
            {(() => {
              let lastGroup: string | undefined = undefined
              return filteredOptions.map((opt) => {
                const isSelected = opt.value === value
                const showGroupHeader = opt.group !== undefined && opt.group !== lastGroup
                if (opt.group !== undefined) lastGroup = opt.group
                return (
                  <div key={String(opt.value)}>
                    {showGroupHeader && (
                      <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 select-none">
                        {opt.group}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onChange(opt.value)
                        setOpen(false)
                      }}
                      className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-all text-sm font-semibold text-left ${
                        isSelected ? 'bg-slate-50/50 text-[#003164]' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {opt.icon && (
                          <div className="shrink-0 flex items-center justify-center">
                            {opt.icon}
                          </div>
                        )}
                        <span className="whitespace-nowrap pr-2">{opt.label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {opt.badge}
                        {isSelected && (
                          <div className="w-5 h-5 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                            <Check size={12} className="text-[#003164]" />
                          </div>
                        )}
                      </div>
                    </button>
                  </div>
                )
              })
            })()}
            {filteredOptions.length === 0 && (
              <div className="text-xs text-slate-400 py-4 text-center">No matches found</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export function Combobox(props: {
  value: any;
  onChange: (val: any) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
}) {
  return <CustomSelect searchable={props.searchable !== false} {...props} />
}

export function renderPaymentMethodIcon(iconVal?: string | null, codeVal?: string) {
  const code = (codeVal || '').toUpperCase();
  const icon = iconVal || '';

  if (icon && (icon.startsWith('data:image') || icon.startsWith('http') || icon.startsWith('/') || icon.endsWith('.png') || icon.endsWith('.jpg') || icon.endsWith('.svg'))) {
    return <img src={icon} alt={code} className="w-5 h-5 object-contain rounded shrink-0" />;
  }
  if (code === 'CASH' || icon === '💵') {
    return <span className="text-base leading-none shrink-0">💵</span>;
  }
  if (code === 'QR_ESEWA' || icon === '🟢') {
    return <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-xs shrink-0">e</span>;
  }
  if (code === 'QR_KHALTI' || icon === '🚀') {
    return <span className="text-base leading-none shrink-0">🚀</span>;
  }
  if (code === 'CARD' || icon === '💳') {
    return <span className="text-base leading-none shrink-0">💳</span>;
  }
  if (code === 'FONEPAY_QR' || icon === '📲') {
    return <span className="text-[10px] bg-rose-600 text-white font-extrabold px-1 py-0.5 rounded tracking-tighter shrink-0">fonepay</span>;
  }
  return <span className="text-base leading-none shrink-0">{icon || '💳'}</span>;
}

