import { ComponentType, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/nmsFormat'

export type Tone = 'primary' | 'success' | 'warning' | 'danger'
type IconType = ComponentType<{ className?: string }>

const toneChip: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
}

export function IconChip({ icon: Icon, tone = 'primary', size = 'md' }: { icon: IconType; tone?: Tone; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('flex flex-shrink-0 items-center justify-center rounded-xl', size === 'lg' ? 'h-10 w-10' : 'h-8 w-8', toneChip[tone])}>
      <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
    </span>
  )
}

export { PageTitle } from '../ui'

export function Card({ title, subtitle, action, children, className, icon, tone = 'primary' }: {
  title?: string
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  icon?: IconType
  tone?: Tone
}) {
  return (
    <section className={cn('glass-card overflow-hidden shadow-sm transition-all', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 dark:border-slate-800/80 px-5 py-3.5 bg-slate-50/50 dark:bg-slate-900/40">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <IconChip icon={icon} tone={tone} />}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

const sevStyle: Record<string, string> = {
  P1: 'bg-rose-500 text-white font-bold',
  P2: 'bg-amber-500 text-white font-bold',
  P3: 'bg-blue-600 text-white font-bold',
}

export const SeverityBadge = ({ s }: { s: string }) => (
  <span className={cn('inline-block rounded-md px-2 py-0.5 text-xs font-semibold shadow-xs', sevStyle[s] ?? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200')}>
    {s}
  </span>
)

const stateStyle: Record<string, string> = {
  up: 'text-emerald-600 dark:text-emerald-400',
  online: 'text-emerald-600 dark:text-emerald-400',
  succeeded: 'text-emerald-600 dark:text-emerald-400',
  resolved: 'text-emerald-600 dark:text-emerald-400',
  ok: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-rose-600 dark:text-rose-400',
  offline: 'text-rose-600 dark:text-rose-400',
  failed: 'text-rose-600 dark:text-rose-400',
  failed_needs_review: 'text-rose-600 dark:text-rose-400',
  open: 'text-rose-600 dark:text-rose-400',
  rolled_back: 'text-amber-600 dark:text-amber-400',
  partially_applied: 'text-amber-600 dark:text-amber-400',
  acknowledged: 'text-amber-600 dark:text-amber-400',
  planned: 'text-blue-600 dark:text-blue-400',
  approved: 'text-blue-600 dark:text-blue-400',
  running: 'text-indigo-600 dark:text-indigo-400',
}

export const StatusText = ({ s }: { s: string }) => (
  <span className={cn('inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold capitalize', stateStyle[s] ?? 'text-slate-500 dark:text-slate-400')}>
    <span className="h-2 w-2 rounded-full bg-current shrink-0" aria-hidden />
    {s.replace(/_/g, ' ')}
  </span>
)

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800/80 bg-white/50 dark:bg-slate-900/40">
      <table className="w-full border-collapse text-left text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/60">
            {head.map((h) => (
              <th key={h} className="p-3.5 font-semibold text-slate-700 dark:text-slate-300 tracking-tight whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">{children}</tbody>
      </table>
      {empty && <p className="p-8 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">{empty}</p>}
    </div>
  )
}

export const Tr = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
  <tr
    onClick={onClick}
    className={cn(
      'transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50',
      onClick && 'cursor-pointer'
    )}
  >
    {children}
  </tr>
)

export const Td = ({ children, className, onClick }: { children?: ReactNode; className?: string; onClick?: (e: React.MouseEvent) => void }) => (
  <td onClick={onClick} className={cn('p-3.5 align-middle text-slate-700 dark:text-slate-300', className)}>{children}</td>
)

export const Loading = () => (
  <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500 dark:text-slate-400">
    <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading...
  </div>
)

export const ErrorBox = ({ msg }: { msg: string }) => (
  <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/80 dark:bg-rose-950/30 p-4 text-sm text-rose-700 dark:text-rose-300">
    {msg}
  </div>
)

export function UtilBar({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-400">-</span>
  const color = v >= 95 ? 'bg-rose-500' : v >= 90 ? 'bg-amber-500' : v >= 80 ? 'bg-blue-500' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2" title={`${v.toFixed(1)}%`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={cn('h-full transition-all', color)} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{v.toFixed(0)}%</span>
    </div>
  )
}

export const inputCls =
  'w-full rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50'

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block text-sm">
    <span className="mb-1.5 block font-semibold text-slate-700 dark:text-slate-200 text-xs sm:text-sm">{label}</span>
    {children}
  </label>
)
