import { useCallback, useEffect, useState } from 'react'

/**
 * Install plumbing shared by the install banner and the "Install App" menu
 * entries in the app shell.
 *
 * Three platform families, three different realities:
 *  - Chrome/Edge (Android, Windows, Mac) fire `beforeinstallprompt`, which we
 *    capture and replay later from a real user gesture. This is the only path
 *    that can show a native install dialog.
 *  - iOS/iPadOS Safari never fires it, and has no programmatic install at all —
 *    the user has to go through Share → Add to Home Screen, so all we can do is
 *    tell them how.
 *  - Firefox and friends offer neither, so we stay out of the way entirely.
 */

/** The event isn't in TS's DOM lib yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'airlink_install_dismissed_at'
/** How long a dismissal sticks before the banner may offer itself again. */
const DISMISS_DAYS = 14

/** True when we're already running as an installed app, so there's nothing to offer. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    // iOS Safari's non-standard flag — the only signal available there.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** iOS and iPadOS, including iPadOS 13+ which reports itself as a Mac with touch. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Coarse pointer / no hover reads as a phone or tablet, which changes the copy. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    if (!at) return false
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Private mode / storage disabled: treat as never dismissed.
    return false
  }
}

export interface PwaInstall {
  /** A native install dialog can be opened right now. */
  canInstall: boolean
  /** No native path exists, but we can show Add-to-Home-Screen steps (iOS). */
  needsIosInstructions: boolean
  /** Already running installed — hide every install affordance. */
  installed: boolean
  /** The banner should be on screen (not dismissed, not installed). */
  bannerVisible: boolean
  /** Phrase copy for a phone vs. a computer. */
  touch: boolean
  /** Opens the native dialog. Resolves true when the user accepted. */
  promptInstall: () => Promise<boolean>
  /** Hides the banner and remembers the choice for {@link DISMISS_DAYS}. */
  dismissBanner: () => void
}

export function usePwaInstall(): PwaInstall {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isInstalled)
  const [dismissed, setDismissed] = useState(dismissedRecently)
  const [ios] = useState(isIos)
  const [touch] = useState(isTouchDevice)

  useEffect(() => {
    // Chrome fires this before showing its own mini-infobar; preventDefault
    // hands us the timing so the offer appears inside the app's own UI.
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    // Catches the install completing in another tab, and the user launching the
    // installed copy from a window that started out in the browser.
    const mq = window.matchMedia('(display-mode: standalone)')
    const onDisplayModeChange = () => setInstalled(isInstalled())
    mq.addEventListener?.('change', onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      mq.removeEventListener?.('change', onDisplayModeChange)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!event) return false
    await event.prompt()
    const { outcome } = await event.userChoice
    // The event is single-use: Chrome will fire a fresh one if the user
    // declined and later becomes eligible again.
    setEvent(null)
    if (outcome === 'accepted') setInstalled(true)
    return outcome === 'accepted'
  }, [event])

  const dismissBanner = useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Nothing to persist to; the in-memory flag still hides it this session.
    }
  }, [])

  const canInstall = !installed && !!event
  const needsIosInstructions = !installed && ios && !event

  return {
    canInstall,
    needsIosInstructions,
    installed,
    bannerVisible: !dismissed && (canInstall || needsIosInstructions),
    touch,
    promptInstall,
    dismissBanner,
  }
}
