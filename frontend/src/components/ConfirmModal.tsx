import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2 } from 'lucide-react'

export interface ConfirmState {
  isOpen: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'warning' | 'info'
  onConfirm: () => void | Promise<void>
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'danger',
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'warning' | 'info'
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const backdropMouseDown = useRef(false)

  if (!open) return null

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        'Something went wrong.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setError('')
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-sm"
      onMouseDown={(e) => { backdropMouseDown.current = e.target === e.currentTarget }}
      onMouseUp={(e) => { if (backdropMouseDown.current && e.target === e.currentTarget) handleClose(); backdropMouseDown.current = false }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${tone === 'danger' ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-500 dark:text-rose-400' : 'bg-amber-50 dark:bg-amber-950/50 text-amber-500 dark:text-amber-400'}`}>
              <AlertTriangle size={16} />
            </div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">{title}</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all disabled:opacity-40"
          >
            <span className="text-base font-light leading-none">&times;</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{message}</p>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/60 rounded-xl">
              <AlertTriangle size={13} className="text-rose-500 shrink-0" />
              <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={`px-4 py-2 rounded-xl font-bold text-xs text-white shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-1.5 ${
                tone === 'danger'
                  ? 'bg-rose-600 hover:bg-rose-700'
                  : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {loading && <Loader2 size={12} className="animate-spin" />}
              {loading ? 'Processing…' : confirmText}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  )
}
