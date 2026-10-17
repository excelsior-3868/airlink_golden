import { useCallback, useEffect, useRef } from 'react'
import { api } from './api'

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void
      execute: (siteKey: string, opts: { action: string }) => Promise<string>
    }
  }
}

// Site key comes from the backend at runtime (null = reCAPTCHA disabled), so the
// same frontend build works for every tenant.
let siteKeyPromise: Promise<string | null> | null = null
const loadSiteKey = () =>
  (siteKeyPromise ??= api
    .get('/auth/recaptcha-config')
    .then(r => (r.data?.data?.site_key as string | null) ?? null)
    .catch(() => {
      siteKeyPromise = null
      return null
    }))

const loadScript = (siteKey: string) =>
  new Promise<void>((resolve, reject) => {
    if (window.grecaptcha) return resolve()
    const s = document.createElement('script')
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load reCAPTCHA'))
    document.head.appendChild(s)
  })

/** reCAPTCHA v3: preloads the script and returns a function yielding a token for `action` (undefined when disabled). */
export function useRecaptcha(action: string) {
  const keyRef = useRef<string | null>(null)

  useEffect(() => {
    let badge: HTMLElement | null = null
    loadSiteKey().then(key => {
      keyRef.current = key
      if (key) loadScript(key).catch(() => {})
    })
    return () => {
      // v3 injects a floating badge; hide it once we leave the login page.
      badge = document.querySelector('.grecaptcha-badge')?.parentElement as HTMLElement | null
      if (badge) badge.style.visibility = 'hidden'
    }
  }, [])

  return useCallback(async (): Promise<string | undefined> => {
    const key = keyRef.current ?? (await loadSiteKey())
    if (!key) return undefined
    await loadScript(key)
    const badge = document.querySelector('.grecaptcha-badge')?.parentElement as HTMLElement | null
    if (badge) badge.style.visibility = 'visible'
    return new Promise<string>((resolve, reject) => {
      window.grecaptcha!.ready(() => window.grecaptcha!.execute(key, { action }).then(resolve, reject))
    })
  }, [action])
}
