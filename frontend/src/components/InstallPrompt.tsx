import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, X } from 'lucide-react'
import { usePwaInstall } from '../lib/pwaInstall'
import { useBranding } from '../lib/branding'
import IosInstallSheet from './IosInstallSheet'

/**
 * The first-run install offer. Chrome/Edge on Android, Windows and Mac get a
 * real install button wired to the deferred `beforeinstallprompt` event; iOS
 * Safari has no programmatic install, so it gets the Add to Home Screen steps
 * instead. Browsers that support neither show nothing.
 *
 * Dismissing it hides it for a couple of weeks — the "Install App" entry in
 * the app shell stays available the whole time for anyone who wants it sooner.
 *
 * Rendered inside <BottomDock>, which owns the positioning.
 */
export default function InstallPrompt() {
  const { bannerVisible, canInstall, touch, promptInstall, dismissBanner } = usePwaInstall()
  const { branding } = useBranding()
  const [iosOpen, setIosOpen] = useState(false)

  const appName = branding.property_name || 'Airlink'

  return (
    <>
      <AnimatePresence>
        {bannerVisible && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="pointer-events-auto relative w-full max-w-md bg-white border border-slate-200 rounded-3xl shadow-2xl p-4 flex gap-3.5"
          >
            <div className="w-11 h-11 rounded-2xl bg-slate-100 text-[#003164] flex items-center justify-center shrink-0">
              <Download size={20} />
            </div>

            {/* Title, copy and the action share one column, so the button lines
                up under the text rather than beside it. */}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold text-slate-900 leading-tight pr-6">Install This App</p>
              <p className="text-[13px] text-slate-500 leading-snug mt-1">
                {touch
                  ? 'Add it to your home screen to open it full-screen and keep working when the connection drops.'
                  : 'Install it to open in a dedicated window and keep working when the connection drops.'}
              </p>
              <button
                onClick={() => (canInstall ? promptInstall() : setIosOpen(true))}
                className="mt-3 inline-flex items-center gap-2 bg-[#003164] text-white text-sm font-bold pl-3.5 pr-4 py-2 rounded-xl shadow-lg shadow-[#003164]/20 hover:bg-[#00284f] active:scale-95 transition-all"
              >
                <Download size={15} />
                {canInstall ? 'Install' : 'How to Install'}
              </button>
            </div>

            <button
              onClick={dismissBanner}
              className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              aria-label="Dismiss install prompt"
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <IosInstallSheet
        open={iosOpen}
        onClose={() => { setIosOpen(false); dismissBanner() }}
        appName={appName}
      />
    </>
  )
}
