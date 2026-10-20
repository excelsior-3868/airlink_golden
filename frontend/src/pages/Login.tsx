import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock, User as UserIcon, Wifi, Eye, EyeOff, Loader2, ArrowRight, ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { useAuth, type AuthUser } from '../lib/auth'
import { useBranding } from '../lib/branding'
import { api, apiError } from '../lib/api'
import { ThemeToggle } from '../lib/theme'
import { useRecaptcha } from '../lib/recaptcha'

export default function Login() {
  const { login, verifyTwoFactor, completeLogin, user } = useAuth()
  const { branding } = useBranding()
  const nav = useNavigate()
  const getRecaptchaToken = useRecaptcha('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Two-factor step (shown after the password is accepted for roles that require it).
  const [challenge, setChallenge] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  // After enrolling: sign-in is held back until the user has saved their recovery codes.
  const [pending, setPending] = useState<{ token: string; user: AuthUser; codes: string[] } | null>(null)

  if (user && !pending) nav('/', { replace: true })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const res = await login(username, password, await getRecaptchaToken())
      if (res.status === '2fa') {
        setChallenge(res.challenge)
        setEnrolling(res.enrollRequired)
        if (res.enrollRequired) {
          const { data } = await api.post('/login/2fa/setup', { challenge: res.challenge })
          setSecret(data.data.secret)
          setQr(await QRCode.toDataURL(data.data.otpauth_uri, { margin: 1, width: 192 }))
        }
        return
      }
      nav('/', { replace: true })
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!challenge) return
    setErr('')
    setBusy(true)
    try {
      const res = await verifyTwoFactor(challenge, code)
      if (res.recoveryCodes) {
        setPending({ token: res.token, user: res.user, codes: res.recoveryCodes })
      } else {
        completeLogin(res.token, res.user)
        nav('/', { replace: true })
      }
    } catch (e) {
      setErr(apiError(e))
      // Challenge expired or too many tries: start over from the password step.
      if ((e as any)?.response?.status === 401 || (e as any)?.response?.status === 429) {
        setChallenge(null)
        setCode('')
      }
    } finally {
      setBusy(false)
    }
  }

  const finishEnrolment = () => {
    if (!pending) return
    completeLogin(pending.token, pending.user)
    nav('/', { replace: true })
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
          {pending ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <ShieldCheck size={18} className="text-emerald-500" /> Two-factor enabled
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-3 font-mono text-sm text-slate-900 dark:text-slate-100 select-all">
                {pending.codes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(pending.codes.join('\n')).catch(() => {})}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer bg-transparent"
              >
                Copy codes
              </button>
              <button
                type="button"
                onClick={finishEnrolment}
                style={{ backgroundColor: branding.primary_color }}
                className="w-full hover:brightness-90 text-white rounded-xl py-3 px-4 font-semibold shadow-md border-none cursor-pointer"
              >
                I have saved them — continue
              </button>
            </div>
          ) : challenge ? (
            <form onSubmit={submitCode} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <ShieldCheck size={18} className="text-[#1d63bf]" /> {enrolling ? 'Set up two-factor authentication' : 'Two-factor verification'}
              </div>
              {enrolling ? (
                <div className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
                  <p>1. Scan this QR code with Google Authenticator (or any authenticator app).</p>
                  {qr && <img src={qr} alt="Authenticator QR code" className="mx-auto rounded-lg bg-white p-2" width={192} height={192} />}
                  <p>Can't scan? Enter this key manually: <span className="font-mono select-all break-all text-slate-900 dark:text-white">{secret}</span></p>
                  <p>2. Enter the 6-digit code it shows to finish.</p>
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-300">Enter the 6-digit code from your authenticator app, or a recovery code.</p>
              )}
              <input
                className={`${field} px-4 tracking-widest text-center`}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
              />
              {err && <div className="pill danger w-full justify-center py-2.5 text-xs font-semibold">{err}</div>}
              <button
                disabled={busy || !code.trim()}
                type="submit"
                style={{ backgroundColor: branding.primary_color }}
                className="w-full hover:brightness-90 disabled:opacity-70 text-white rounded-xl py-3 px-4 font-semibold shadow-md border-none cursor-pointer"
              >
                {busy ? 'Verifying...' : enrolling ? 'Enable and sign in' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setChallenge(null); setCode(''); setErr('') }}
                className="w-full text-xs text-[#1d63bf] dark:text-sky-400 hover:underline bg-transparent border-none cursor-pointer"
              >
                Back to sign in
              </button>
            </form>
          ) : (
          <>
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
          </>
          )}
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
