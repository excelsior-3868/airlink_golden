import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Sun, Moon } from 'lucide-react'

export type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  isDark: boolean
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const THEME_STORAGE_KEY = 'airlink_theme'

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'light' || stored === 'dark') {
        return stored
      }
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
    } catch {
      // Fallback if localStorage or matchMedia is inaccessible
    }
    return 'light'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.setAttribute('data-theme', 'dark')
      root.style.colorScheme = 'dark'
    } else {
      root.classList.remove('dark')
      root.setAttribute('data-theme', 'light')
      root.style.colorScheme = 'light'
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore localStorage write error
    }
  }, [theme])

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  const setTheme = (nextTheme: Theme) => {
    setThemeState(nextTheme)
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export interface ThemeToggleProps {
  variant?: 'icon' | 'switch' | 'button' | 'dropdown-item'
  className?: string
  showLabel?: boolean
}

/**
 * Universal Theme Toggle Component
 * Meets Title Case guidelines, works in headers, sidebars, drawers, and modal menus.
 */
export function ThemeToggle({
  variant = 'icon',
  className = '',
  showLabel = true,
}: ThemeToggleProps) {
  const { theme, isDark, toggleTheme } = useTheme()

  const tooltipText = isDark ? 'Switch To Light Mode' : 'Switch To Dark Mode'
  const labelText = isDark ? 'Dark Mode' : 'Light Mode'

  if (variant === 'dropdown-item') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-all text-sm font-semibold text-left select-none ${className}`}
        title={tooltipText}
        aria-label={tooltipText}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            {isDark ? <Moon size={14} /> : <Sun size={14} />}
          </div>
          <span>{labelText}</span>
        </div>
        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
          {isDark ? 'On' : 'Off'}
        </span>
      </button>
    )
  }

  if (variant === 'switch') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`w-full flex items-center justify-between gap-3 p-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-left transition-all select-none ${className}`}
        title={tooltipText}
        aria-label={tooltipText}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-indigo-950/70 border border-amber-100 dark:border-indigo-800/60 text-amber-600 dark:text-indigo-300 flex items-center justify-center shrink-0 transition-colors">
            {isDark ? <Moon size={15} /> : <Sun size={15} />}
          </div>
          {showLabel && (
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-tight truncate">
                {labelText}
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-400 font-medium leading-none mt-0.5">
                {isDark ? 'Dark Theme Active' : 'Light Theme Active'}
              </p>
            </div>
          )}
        </div>

        {/* Sliding Pill Indicator */}
        <div className="relative w-11 h-6 rounded-full bg-slate-200 dark:bg-slate-700 p-0.5 transition-colors shrink-0">
          <motion.div
            animate={{ x: isDark ? 20 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="w-5 h-5 rounded-full bg-white dark:bg-indigo-400 shadow-sm flex items-center justify-center"
          >
            {isDark ? (
              <Moon size={10} className="text-indigo-950" />
            ) : (
              <Sun size={10} className="text-amber-500" />
            )}
          </motion.div>
        </div>
      </button>
    )
  }

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-xs ${className}`}
        title={tooltipText}
        aria-label={tooltipText}
      >
        <span className="text-amber-500 dark:text-indigo-400">
          {isDark ? <Moon size={14} /> : <Sun size={14} />}
        </span>
        {showLabel && <span>{labelText}</span>}
      </button>
    )
  }

  // Default 'icon' variant
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition-all shadow-xs shrink-0 ${className}`}
      title={tooltipText}
      aria-label={tooltipText}
    >
      <motion.div
        key={theme}
        initial={{ rotate: -45, scale: 0.7, opacity: 0 }}
        animate={{ rotate: 0, scale: 1, opacity: 1 }}
        exit={{ rotate: 45, scale: 0.7, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-center justify-center text-amber-500 dark:text-indigo-300"
      >
        {isDark ? <Moon size={16} /> : <Sun size={16} />}
      </motion.div>
    </button>
  )
}
