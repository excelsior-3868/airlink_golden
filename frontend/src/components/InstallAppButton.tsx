import { useState } from 'react'
import { Download } from 'lucide-react'
import { usePwaInstall } from '../lib/pwaInstall'
import { useBranding } from '../lib/branding'
import IosInstallSheet from './IosInstallSheet'

/**
 * The persistent "Install App" affordance in the app shell (desktop profile
 * menu and mobile drawer). Renders nothing once the app is installed, or on
 * browsers with no install path at all, so it never becomes a dead button.
 *
 * `variant` matches the two hosts: 'menu' is a row for the desktop profile
 * dropdown, 'compact' is the denser full-width row used in the mobile drawer.
 */
export default function InstallAppButton({
  variant = 'menu',
  onDone,
}: {
  variant?: 'menu' | 'compact'
  onDone?: () => void
}) {
  const { canInstall, needsIosInstructions, promptInstall } = usePwaInstall()
  const { branding } = useBranding()
  const [iosOpen, setIosOpen] = useState(false)

  if (!canInstall && !needsIosInstructions) return null

  const activate = () => {
    if (canInstall) {
      promptInstall()
      onDone?.()
    } else {
      // iOS: the steps have to stay on screen, so don't close the host menu.
      setIosOpen(true)
    }
  }

  return (
    <>
      {variant === 'compact' ? (
        <button
          onClick={activate}
          className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl border border-blue-100 bg-blue-50/50 text-[#003164] text-xs font-bold active:scale-95 transition-transform"
        >
          <Download size={14} /> Install
        </button>
      ) : (
        <button
          onClick={activate}
          className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-slate-700 hover:text-slate-900 transition-all text-sm font-semibold text-left"
        >
          <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 text-[#003164] flex items-center justify-center shrink-0">
            <Download size={14} />
          </div>
          Install App
        </button>
      )}

      <IosInstallSheet
        open={iosOpen}
        onClose={() => { setIosOpen(false); onDone?.() }}
        appName={branding.property_name || 'Airlink'}
      />
    </>
  )
}
