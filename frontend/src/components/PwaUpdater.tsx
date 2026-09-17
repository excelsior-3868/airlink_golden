import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, CheckCircle2, X } from 'lucide-react'

/**
 * Registers the service worker and surfaces two lightweight, dismissible toasts:
 *  - "Update available"   → a new build is cached; tapping reloads into it.
 *  - "Ready to work offline" → the app shell has been cached for the first time.
 * The SW is configured with registerType: 'autoUpdate', so updates also apply
 * on the next full navigation even if the toast is ignored.
 */
export default function PwaUpdater() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [update, setUpdate] = useState<(reload?: boolean) => Promise<void>>()

  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true)
      },
      onOfflineReady() {
        setOfflineReady(true)
      },
    })
    setUpdate(() => updateSW)
  }, [])

  // Auto-hide the "offline ready" confirmation after a few seconds.
  useEffect(() => {
    if (!offlineReady) return
    const t = setTimeout(() => setOfflineReady(false), 4000)
    return () => clearTimeout(t)
  }, [offlineReady])

  const show = needRefresh || offlineReady

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          /* Positioning belongs to <BottomDock>, which stacks this with the
             install offer instead of letting the two overlap. */
          className="pointer-events-auto w-full max-w-sm"
        >
          {needRefresh ? (
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 pl-4">
              <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 text-[#003164] flex items-center justify-center shrink-0">
                <RefreshCw size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 leading-tight">New version available</p>
                <p className="text-xs text-slate-500 leading-tight mt-0.5">Reload to get the latest update.</p>
              </div>
              <button
                onClick={() => update?.(true)}
                className="btn-primary py-1.5 px-3.5 rounded-xl text-xs font-bold shrink-0"
              >
                Reload
              </button>
              <button
                onClick={() => setNeedRefresh(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 shrink-0"
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 pl-4">
              <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 size={16} />
              </div>
              <p className="text-sm font-semibold text-slate-700 flex-1">Ready to work offline</p>
              <button
                onClick={() => setOfflineReady(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-50 shrink-0"
                aria-label="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
