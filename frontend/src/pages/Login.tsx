import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock, User as UserIcon, Wifi, Eye, EyeOff, LogIn, Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useBranding } from '../lib/branding'
import { apiError } from '../lib/api'

export default function Login() {
  const { login, user } = useAuth()
  const { branding } = useBranding()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) nav('/', { replace: true })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await login(username, password)
      nav('/', { replace: true })
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background glows */}
      <div className="absolute top-[10%] left-[10%] w-[30%] h-[30%] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] right-[10%] w-[30%] h-[30%] bg-rose-500/5 rounded-full blur-[120px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="bg-white border border-slate-200/60 rounded-[32px] shadow-2xl p-8 sm:p-10 max-w-md w-full relative z-10 animate-fade-in"
      >
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-[#003164] text-white rounded-3xl p-4 mb-4 shadow-xl shadow-[#003164]/20 flex items-center justify-center w-16 h-16 overflow-hidden">
            {branding.logo_url ? (
              <img src={branding.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <Wifi size={28} />
            )}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[#003164] text-center">
            {branding.property_name || 'Airlink'}
          </h1>
          <p className="text-slate-500 text-sm mt-2 text-center font-medium">
            Please enter your credentials to access {branding.property_name || 'Airlink'}.
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-11 bg-[#f0f4ff]/50 hover:bg-[#f0f4ff]/70 border-slate-200 focus:border-[#003164]/30 rounded-2xl py-3 text-sm font-semibold transition-all w-full"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>

          <div className="relative">
            <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-11 pr-11 bg-[#f0f4ff]/50 hover:bg-[#f0f4ff]/70 border-slate-200 focus:border-[#003164]/30 rounded-2xl py-3 text-sm font-semibold transition-all w-full"
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Remember me & Forgot Password */}
          <div className="flex items-center justify-between text-xs font-semibold pt-1">
            <label className="flex items-center gap-2 text-slate-500 cursor-pointer select-none">
              <input type="checkbox" className="rounded border-slate-300 text-[#003164] focus:ring-[#003164]" />
              Keep signed in
            </label>
            <a href="#" onClick={(e) => { e.preventDefault(); alert("Please contact your administrator to reset your password.") }} className="text-[#6b1414] hover:underline">
              Forgot password?
            </a>
          </div>

          {err && <div className="pill danger w-full justify-center py-2.5 text-xs font-semibold">{err}</div>}

          {/* Submit Button */}
          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={busy}
            type="submit"
            className="w-full bg-gradient-to-r from-[#6b1414] to-[#2c2053] hover:from-[#7a1818] hover:to-[#382b63] text-white rounded-2xl py-3.5 px-4 font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/20 transition-all border-none mt-2 cursor-pointer"
          >
            {busy ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <LogIn size={18} />
            )}
            {busy ? 'Signing In...' : 'Sign In to Portal'}
          </motion.button>
        </form>

      </motion.div>

      {/* Footer copyright section */}
      <div className="mt-6 text-center text-xs font-semibold text-slate-400/80 leading-relaxed select-none">
        <p>© 2026 Airlink - A Billing Management System.</p>
        <p className="mt-1">Powered By <span className="text-[#6b1414] font-bold">Netcare Nepal Pvt Ltd.</span></p>
      </div>
    </div>
  )
}
