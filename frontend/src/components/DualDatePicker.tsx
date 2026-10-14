import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react'
import {
  adToBs,
  bsToAd,
  getBsDaysInMonth,
  formatAdIso,
  BS_MONTH_NAMES_EN,
  BS_MONTH_NAMES_NP,
  BS_WEEKDAYS_NP,
  AD_WEEKDAYS_EN,
  AD_MONTH_NAMES
} from '../lib/nepaliDate'

export interface DualDatePickerProps {
  value?: string // YYYY-MM-DD
  onChange?: (date: string) => void
  label?: string
  placeholder?: string
  className?: string
  disabled?: boolean
  initialMode?: 'AD' | 'BS'
}

export function DualDatePicker({
  value = '',
  onChange,
  label = 'Registration Date',
  placeholder = 'Select Date',
  className = '',
  disabled = false,
  initialMode = 'AD'
}: DualDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mode, setMode] = useState<'AD' | 'BS'>(initialMode)
  const containerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  // Current selected AD date object (or today if empty)
  const selectedAdDate = value ? new Date(value) : null
  const selectedBsDate = selectedAdDate ? adToBs(selectedAdDate) : null

  // Viewing state (Year & Month being browsed in calendar popover)
  const todayAd = new Date()
  const todayBs = adToBs(todayAd)

  const [viewAdYear, setViewAdYear] = useState<number>(selectedAdDate ? selectedAdDate.getFullYear() : todayAd.getFullYear())
  const [viewAdMonth, setViewAdMonth] = useState<number>(selectedAdDate ? selectedAdDate.getMonth() + 1 : todayAd.getMonth() + 1) // 1-12

  const [viewBsYear, setViewBsYear] = useState<number>(selectedBsDate ? selectedBsDate.bsYear : todayBs.bsYear)
  const [viewBsMonth, setViewBsMonth] = useState<number>(selectedBsDate ? selectedBsDate.bsMonth : todayBs.bsMonth) // 1-12

  // Dropdown states for month/year selection inside calendar
  const [showMonthDropdown, setShowMonthDropdown] = useState(false)
  const [showYearDropdown, setShowYearDropdown] = useState(false)

  // Calculate coordinates to render popover directly in document.body
  const updateCoords = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const popoverWidth = 265
      const popoverHeight = popoverRef.current ? popoverRef.current.offsetHeight : 290
      let left = rect.left + window.scrollX

      // Prevent popover from clipping off screen right edge
      if (left + popoverWidth > window.innerWidth - 16) {
        left = Math.max(16, rect.right + window.scrollX - popoverWidth)
      }

      // Position popover ABOVE the input field by default
      let top = rect.top + window.scrollY - popoverHeight - 6
      if (top < window.scrollY + 8 && (window.innerHeight - rect.bottom) >= popoverHeight) {
        top = rect.bottom + window.scrollY + 6
      }

      setCoords({ top, left })
    }
  }

  useEffect(() => {
    if (isOpen) {
      updateCoords()
      window.addEventListener('resize', updateCoords)
      window.addEventListener('scroll', updateCoords, true)
    }
    return () => {
      window.removeEventListener('resize', updateCoords)
      window.removeEventListener('scroll', updateCoords, true)
    }
  }, [isOpen])

  // Sync viewing state when value changes
  useEffect(() => {
    if (selectedAdDate && !isNaN(selectedAdDate.getTime())) {
      setViewAdYear(selectedAdDate.getFullYear())
      setViewAdMonth(selectedAdDate.getMonth() + 1)
      const bs = adToBs(selectedAdDate)
      setViewBsYear(bs.bsYear)
      setViewBsMonth(bs.bsMonth)
    }
  }, [value])

  // Handle click outside to close popover
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        (!popoverRef.current || !popoverRef.current.contains(event.target as Node))
      ) {
        setIsOpen(false)
        setShowMonthDropdown(false)
        setShowYearDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [isOpen])

  // Switch between AD and BS modes
  const handleModeSwitch = (newMode: 'AD' | 'BS') => {
    setMode(newMode)
    setShowMonthDropdown(false)
    setShowYearDropdown(false)
  }

  // Prev / Next Month
  const handlePrevMonth = () => {
    setShowMonthDropdown(false)
    setShowYearDropdown(false)
    if (mode === 'AD') {
      if (viewAdMonth === 1) {
        setViewAdMonth(12)
        setViewAdYear(viewAdYear - 1)
      } else {
        setViewAdMonth(viewAdMonth - 1)
      }
    } else {
      if (viewBsMonth === 1) {
        setViewBsMonth(12)
        setViewBsYear(viewBsYear - 1)
      } else {
        setViewBsMonth(viewBsMonth - 1)
      }
    }
  }

  const handleNextMonth = () => {
    setShowMonthDropdown(false)
    setShowYearDropdown(false)
    if (mode === 'AD') {
      if (viewAdMonth === 12) {
        setViewAdMonth(1)
        setViewAdYear(viewAdYear + 1)
      } else {
        setViewAdMonth(viewAdMonth + 1)
      }
    } else {
      if (viewBsMonth === 12) {
        setViewBsMonth(1)
        setViewBsYear(viewBsYear + 1)
      } else {
        setViewBsMonth(viewBsMonth + 1)
      }
    }
  }

  // Select day in BS mode
  const handleSelectBsDay = (day: number) => {
    const adDateObj = bsToAd(viewBsYear, viewBsMonth, day)
    const isoDate = formatAdIso(adDateObj)
    onChange?.(isoDate)
    setIsOpen(false)
  }

  // Select day in AD mode
  const handleSelectAdDay = (day: number) => {
    const adDateObj = new Date(viewAdYear, viewAdMonth - 1, day)
    const isoDate = formatAdIso(adDateObj)
    onChange?.(isoDate)
    setIsOpen(false)
  }

  // Clear date
  const handleClear = () => {
    onChange?.('')
    setIsOpen(false)
  }

  // Set today
  const handleToday = () => {
    const today = new Date()
    const isoDate = formatAdIso(today)
    onChange?.(isoDate)
    const bs = adToBs(today)
    setViewAdYear(today.getFullYear())
    setViewAdMonth(today.getMonth() + 1)
    setViewBsYear(bs.bsYear)
    setViewBsMonth(bs.bsMonth)
    setIsOpen(false)
  }

  // Generate days grid for BS view
  const renderBsGrid = () => {
    const totalDays = getBsDaysInMonth(viewBsYear, viewBsMonth)
    const firstDayAd = bsToAd(viewBsYear, viewBsMonth, 1)
    const startDayOfWeek = firstDayAd.getDay() // 0 = Sun, 6 = Sat

    const blanks = Array.from({ length: startDayOfWeek }, (_, i) => i)
    const days = Array.from({ length: totalDays }, (_, i) => i + 1)

    return (
      <div className="grid grid-cols-7 gap-0.5 px-2 py-1 text-center">
        {blanks.map((b) => (
          <div key={`blank-${b}`} className="h-7 w-7" />
        ))}
        {days.map((d) => {
          const isSelected =
            selectedBsDate &&
            selectedBsDate.bsYear === viewBsYear &&
            selectedBsDate.bsMonth === viewBsMonth &&
            selectedBsDate.bsDay === d

          const isToday =
            todayBs.bsYear === viewBsYear &&
            todayBs.bsMonth === viewBsMonth &&
            todayBs.bsDay === d

          return (
            <button
              key={`day-${d}`}
              type="button"
              onClick={() => handleSelectBsDay(d)}
              className={`h-7 w-7 mx-auto flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 ${
                isSelected
                  ? 'bg-[#003164] dark:bg-sky-600 text-white font-bold rounded-lg shadow-sm scale-105'
                  : isToday
                  ? 'border border-[#003164] dark:border-sky-500 text-[#003164] dark:text-sky-400 font-bold hover:bg-blue-50 dark:hover:bg-slate-800'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>
    )
  }

  // Generate days grid for AD view
  const renderAdGrid = () => {
    const totalDays = new Date(viewAdYear, viewAdMonth, 0).getDate()
    const startDayOfWeek = new Date(viewAdYear, viewAdMonth - 1, 1).getDay()

    const blanks = Array.from({ length: startDayOfWeek }, (_, i) => i)
    const days = Array.from({ length: totalDays }, (_, i) => i + 1)

    return (
      <div className="grid grid-cols-7 gap-0.5 px-2 py-1 text-center">
        {blanks.map((b) => (
          <div key={`blank-${b}`} className="h-7 w-7" />
        ))}
        {days.map((d) => {
          const isSelected =
            selectedAdDate &&
            selectedAdDate.getFullYear() === viewAdYear &&
            selectedAdDate.getMonth() + 1 === viewAdMonth &&
            selectedAdDate.getDate() === d

          const isToday =
            todayAd.getFullYear() === viewAdYear &&
            todayAd.getMonth() + 1 === viewAdMonth &&
            todayAd.getDate() === d

          return (
            <button
              key={`day-${d}`}
              type="button"
              onClick={() => handleSelectAdDay(d)}
              className={`h-7 w-7 mx-auto flex items-center justify-center rounded-lg text-xs font-semibold transition-all duration-150 ${
                isSelected
                  ? 'bg-[#003164] dark:bg-sky-600 text-white font-bold rounded-lg shadow-sm scale-105'
                  : isToday
                  ? 'border border-[#003164] dark:border-sky-500 text-[#003164] dark:text-sky-400 font-bold hover:bg-blue-50 dark:hover:bg-slate-800'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {d}
            </button>
          )
        })}
      </div>
    )
  }

  // Year options list
  const bsYearsList = Array.from({ length: 21 }, (_, i) => 2070 + i) // 2070 to 2090
  const adYearsList = Array.from({ length: 21 }, (_, i) => 2013 + i) // 2013 to 2033

  // Formatted display value for input
  const displayFormattedValue = () => {
    if (!selectedAdDate || isNaN(selectedAdDate.getTime())) return ''
    if (mode === 'BS' && selectedBsDate) {
      return `${BS_MONTH_NAMES_EN[selectedBsDate.bsMonth - 1]} ${selectedBsDate.bsDay}, ${selectedBsDate.bsYear} (${value})`
    }
    return value
  }

  return (
    <div className={`relative inline-block w-full ${isOpen ? 'z-50' : 'z-0'} ${className}`} ref={containerRef}>
      {/* Input Field Display */}
      <div className="relative flex items-center">
        <input
          type="text"
          readOnly
          disabled={disabled}
          placeholder={placeholder}
          value={displayFormattedValue()}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className="input pr-20 cursor-pointer bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 selection:bg-transparent text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-medium shadow-sm hover:border-slate-400 dark:hover:border-slate-600 focus:border-[#003164] dark:focus:border-sky-500 transition-colors"
        />

        <div className="absolute right-2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Clear Date"
            >
              <X size={14} />
            </button>
          )}

          <button
            type="button"
            onClick={() => !disabled && setIsOpen(!isOpen)}
            className="p-1.5 bg-[#003164]/10 dark:bg-sky-500/20 hover:bg-[#003164]/20 dark:hover:bg-sky-500/30 text-[#003164] dark:text-sky-300 rounded-lg border border-[#003164]/30 dark:border-sky-500/30 transition-colors flex items-center justify-center"
            title="Open Calendar"
          >
            <CalendarIcon size={15} />
          </button>
        </div>
      </div>

      {/* Calendar Popover rendered at document.body with createPortal for top-most z-index */}
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: coords.top,
            left: coords.left,
            zIndex: 9999
          }}
        >
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="w-[265px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden font-sans"
            >
              {/* Header with App Primary Theme Background */}
              <div className="bg-[#003164] dark:bg-slate-800 text-white p-2.5 px-3 flex items-center justify-between rounded-t-2xl shadow-inner border-b dark:border-slate-700/80">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CalendarIcon className="w-4 h-4 text-white/90 shrink-0" />
                  <span className="font-bold text-xs tracking-wide truncate">{label}</span>
                </div>

                {/* AD / BS Switch Pills */}
                <div className="bg-black/30 dark:bg-black/40 p-1 rounded-full flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('AD')}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-all duration-200 ${
                      mode === 'AD'
                        ? 'bg-white text-[#003164] dark:text-slate-900 shadow-md'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    AD
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('BS')}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-all duration-200 ${
                      mode === 'BS'
                        ? 'bg-white text-[#003164] dark:text-slate-900 shadow-md'
                        : 'text-white/80 hover:text-white'
                    }`}
                  >
                    BS
                  </button>
                </div>
              </div>

              {/* Navigation Bar (Month & Year selectors with chevrons) */}
              <div className="bg-white dark:bg-slate-900 px-3 py-2 flex items-center justify-between relative border-b border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white transition-colors"
                >
                  <ChevronLeft size={15} />
                </button>

                <div className="flex items-center gap-1.5 relative">
                  {/* Month Dropdown Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMonthDropdown(!showMonthDropdown)
                      setShowYearDropdown(false)
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <span>
                      {mode === 'BS'
                        ? BS_MONTH_NAMES_EN[viewBsMonth - 1]
                        : AD_MONTH_NAMES[viewAdMonth - 1]}
                    </span>
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>

                  <span className="text-slate-300 dark:text-slate-600 font-light text-sm mx-0.5">|</span>

                  {/* Year Dropdown Button */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowYearDropdown(!showYearDropdown)
                      setShowMonthDropdown(false)
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1 transition-colors"
                  >
                    <span>{mode === 'BS' ? viewBsYear : viewAdYear}</span>
                    <ChevronDown size={13} className="text-slate-400" />
                  </button>

                  {/* Month Dropdown Menu */}
                  {showMonthDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-36 max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 py-1 scrollbar-thin">
                      {(mode === 'BS' ? BS_MONTH_NAMES_EN : AD_MONTH_NAMES).map((name, idx) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            if (mode === 'BS') setViewBsMonth(idx + 1)
                            else setViewAdMonth(idx + 1)
                            setShowMonthDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-blue-50 dark:hover:bg-slate-700 hover:text-[#003164] dark:hover:text-sky-300 transition-colors ${
                            (mode === 'BS' ? viewBsMonth : viewAdMonth) === idx + 1
                              ? 'bg-blue-50 dark:bg-slate-700 text-[#003164] dark:text-sky-300 font-bold'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Year Dropdown Menu */}
                  {showYearDropdown && (
                    <div className="absolute top-full right-0 mt-1 w-28 max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 py-1 scrollbar-thin">
                      {(mode === 'BS' ? bsYearsList : adYearsList).map((yr) => (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => {
                            if (mode === 'BS') setViewBsYear(yr)
                            else setViewAdYear(yr)
                            setShowYearDropdown(false)
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-blue-50 dark:hover:bg-slate-700 hover:text-[#003164] dark:hover:text-sky-300 transition-colors ${
                            (mode === 'BS' ? viewBsYear : viewAdYear) === yr
                              ? 'bg-blue-50 dark:bg-slate-700 text-[#003164] dark:text-sky-300 font-bold'
                              : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {yr}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white transition-colors"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Weekday Header Row */}
              <div className="grid grid-cols-7 gap-0.5 px-2 pt-2 pb-1 text-center">
                {(mode === 'BS' ? BS_WEEKDAYS_NP : AD_WEEKDAYS_EN).map((dayName) => (
                  <span key={dayName} className="text-slate-400 dark:text-slate-500 font-bold text-[10px] py-0.5">
                    {dayName}
                  </span>
                ))}
              </div>

              {/* Days Grid */}
              {mode === 'BS' ? renderBsGrid() : renderAdGrid()}

              {/* Footer Bar (Clear & Today Buttons) */}
              <div className="px-3 py-2 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 rounded-b-2xl">
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-xs font-bold text-[#003164] dark:text-sky-400 hover:text-blue-700 dark:hover:text-sky-300 hover:underline px-2 py-0.5 transition-colors"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleToday}
                  className="text-xs font-bold text-[#003164] dark:text-sky-400 hover:text-blue-700 dark:hover:text-sky-300 hover:underline px-2 py-0.5 transition-colors"
                >
                  Today
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>,
        document.body
      )}
    </div>
  )
}
