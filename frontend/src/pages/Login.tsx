import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock, User as UserIcon, Wifi, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useBranding } from '../lib/branding'
import { apiError } from '../lib/api'
import { ThemeToggle } from '../lib/theme'
import { useRecaptcha } from '../lib/recaptcha'

export default function Login() {
  const { login, user } = useAuth()
  const { branding } = useBranding()
  const nav = useNavigate()
  const getRecaptchaToken = useRecaptcha('login')
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
      await login(username, password, await getRecaptchaToken())
      nav('/', { replace: true })
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const name = branding.property_name || 'Airlink'
  const field =
    'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 py-3 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#1d63bf]/40 focus:border-[#1d63bf]'

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-b from-[#b9d3ee] via-[#d7e6f6] to-[#f1f6fc] dark:from-slate-950 dark:via-slate-900 dark:to-slate-900 transition-colors duration-200">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20">
        <ThemeToggle variant="switch" className="shadow-sm" />
      </div>

      {/* Himalayan backdrop, faded toward the bottom so the card stays readable */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none bg-cover bg-center bg-no-repeat opacity-100 dark:opacity-25 transition-opacity duration-200"
        style={{ backgroundImage: "url('/himalayas.jpg')" }}
      />
      <div aria-hidden className="absolute inset-0 pointer-events-none bg-gradient-to-b from-white/10 via-transparent to-white/40 dark:from-slate-950/60 dark:to-slate-950/80" />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-[440px] flex flex-col items-center"
      >
        {/* Logo + welcome */}
        <div className="w-16 h-16 rounded-2xl bg-[#0f3a73] dark:bg-sky-700 text-white shadow-lg shadow-[#0f3a73]/30 flex items-center justify-center overflow-hidden mb-5">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <Wifi size={30} />
          )}
        </div>
        <h1 className={`text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white text-center mb-7`}>
          Welcome to Nepal Airlink
        </h1>

        {/* Card */}
        <div className="w-full rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/60 dark:border-slate-800 shadow-xl shadow-slate-900/10 p-6 sm:p-7">
          <div className="flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-1.5 mb-6">
            <div className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white dark:bg-slate-700 shadow-sm py-2.5 text-sm font-medium text-slate-900 dark:text-white">
              <UserIcon size={16} /> Account login
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">Username</label>
              <div className="relative">
                <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${field} pl-11`}
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">Password</label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className={`${field} pl-11 pr-11`}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400 cursor-pointer select-none">
                <input type="checkbox" className="rounded border-slate-300 dark:border-slate-600 text-[#1d63bf] focus:ring-[#1d63bf] dark:bg-slate-800" />
                Keep signed in
              </label>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); alert('Please contact your administrator to reset your password.') }}
                className="text-[#1d63bf] dark:text-sky-400 hover:underline"
              >
                Forgot password?
              </a>
            </div>

            {err && <div className="pill danger w-full justify-center py-2.5 text-xs font-semibold">{err}</div>}

            <motion.button
              whileTap={{ scale: 0.98 }}
              disabled={busy}
              type="submit"
              style={{ backgroundColor: branding.primary_color }}
              className="relative w-full hover:brightness-90 disabled:opacity-70 text-white rounded-xl py-3.5 px-4 font-semibold flex items-center justify-center shadow-md transition-[filter] border-none cursor-pointer"
            >
              <span className="absolute left-4">{busy ? <Loader2 className="animate-spin" size={18} /> : <Wifi size={18} />}</span>
              {busy ? 'Signing in...' : 'Sign in to portal'}
              <ArrowRight size={18} className="absolute right-4" />
            </motion.button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-slate-500 dark:text-slate-500 leading-relaxed select-none">
          <p>© {new Date().getFullYear()} {name} - A Billing Management System.</p>
          <p className="mt-1">Powered By <span className="text-[#1d63bf] dark:text-sky-400 font-semibold">Nepal Airlink</span></p>
        </div>
      </motion.div>
    </div>
  )
}
