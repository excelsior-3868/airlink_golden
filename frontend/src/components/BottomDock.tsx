import type { ReactNode } from 'react'

/**
 * One fixed slot at the bottom of the viewport for the app's transient notices
 * (install offer, service-worker update). They used to each position
 * themselves, which meant they landed on top of each other whenever both were
 * up; stacking them here makes that impossible.
 *
 * The dock ignores pointer events so it never blocks the page behind it — each
 * card takes them back for its own buttons.
 */
export default function BottomDock({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed z-[9998] inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-2 px-3 sm:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
      {children}
    </div>
  )
}
