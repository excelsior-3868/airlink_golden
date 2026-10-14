import { useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldAlert, Save } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Modal } from './ui'

export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', new_password_confirmation: '' })
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    setErr('')
    setSuccess('')
    try {
      await api.post('/change-password', form)
      setSuccess('Password changed successfully!')
      setForm({ current_password: '', new_password: '', new_password_confirmation: '' })
      setTimeout(() => {
        onClose()
        setSuccess('')
      }, 1500)
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change Account Password"
      subtitle="Update your credentials to secure your account."
      icon={<ShieldAlert size={22} />}
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1.5">Current Password</label>
          <input
            className="input"
            type="password"
            placeholder="••••••••••••"
            value={form.current_password}
            onChange={(e) => setForm({ ...form, current_password: e.target.value })}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1.5">New Password</label>
          <input
            className="input"
            type="password"
            placeholder="••••••••••••"
            value={form.new_password}
            onChange={(e) => setForm({ ...form, new_password: e.target.value })}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 block mb-1.5">Confirm New Password</label>
          <input
            className="input"
            type="password"
            placeholder="••••••••••••"
            value={form.new_password_confirmation}
            onChange={(e) => setForm({ ...form, new_password_confirmation: e.target.value })}
          />
        </div>

        {err && <div className="pill danger w-full justify-center py-2">{err}</div>}
        {success && <div className="pill success w-full justify-center py-2">{success}</div>}

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            className="btn-ghost py-2.5 px-6 rounded-2xl font-bold transition-all"
            onClick={onClose}
          >
            Cancel
          </button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="btn-primary flex items-center gap-2 py-2.5 px-6 rounded-2xl font-bold shadow-md transition-all"
            disabled={busy}
            onClick={save}
          >
            <Save size={16} />
            {busy ? 'Saving...' : 'Change Password'}
          </motion.button>
        </div>
      </div>
    </Modal>
  )
}
