import { AnimatePresence, motion } from 'framer-motion'
import { Share, Plus, X } from 'lucide-react'

/**
 * iOS/iPadOS Safari exposes no install API, so the only thing we can do is
 * show the manual Share → Add to Home Screen steps. Shared by the install
 * banner and the "Install App" entries in the app shell.
 */
export default function IosInstallSheet({
  open,
  onClose,
  appName,
}: {
  open: boolean
  onClose: () => void
  appName: string
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="pointer-events-auto fixed inset-0 z-[9999] bg-slate-950/40 backdrop-blur-sm flex items-end justify-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Add to Home Screen"
            className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-slate-200 p-5"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-[#003164] leading-tight">Add to Home Screen</h2>
                <p className="text-xs text-slate-500 mt-1">Two taps in Safari and {appName} installs like an app.</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-500 shrink-0 active:scale-95 transition-transform"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <ol className="flex flex-col gap-3">
              <li className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-extrabold flex items-center justify-center shrink-0">1</span>
                <span className="text-sm text-slate-700 font-medium flex items-center gap-1.5 flex-wrap">
                  Tap <Share size={15} className="text-blue-600" /> <span className="font-bold">Share</span> in the Safari toolbar.
                </span>
              </li>
              <li className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-extrabold flex items-center justify-center shrink-0">2</span>
                <span className="text-sm text-slate-700 font-medium flex items-center gap-1.5 flex-wrap">
                  Choose <Plus size={15} className="text-blue-600" /> <span className="font-bold">Add to Home Screen</span>.
                </span>
              </li>
            </ol>

            <button onClick={onClose} className="btn-primary w-full mt-5 rounded-2xl text-sm">
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
