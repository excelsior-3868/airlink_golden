import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

export interface ToastState {
  ok: boolean
  text: string
}

/**
 * Lightweight floating toast, styled like PwaUpdater's update banner. There's
 * no toast library in this app — pages own a `{ ok, text } | null` state and
 * render this once near the bottom of their JSX.
 */
export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed z-[9998] left-1/2 -translate-x-1/2 bottom-[calc(1rem+env(safe-area-inset-bottom))] w-[calc(100%-1.5rem)] max-w-sm"
        >
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 pl-4">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${
                toast.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-rose-50 border-rose-100 text-rose-600'
              }`}
            >
              {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            </div>
            <p className="text-sm font-semibold text-slate-700 flex-1">{toast.text}</p>
            <button
              onClick={onDismiss}
              className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 shrink-0"
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
