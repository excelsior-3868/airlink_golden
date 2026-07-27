import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutDashboard, Package, Users2, Store, Wallet as WalletIcon,
  Database, Ticket, LogOut, Wifi, Router, ShieldCheck, Shield,
  ChevronDown, ChevronRight, Key, Gauge, ArrowLeftRight, Menu, X, Terminal, Calendar,
  BookOpen, Receipt
} from 'lucide-react'
import { Role, useAuth } from '../lib/auth'
import { rs, gb } from '../lib/format'
import ChangePasswordModal from '../components/ChangePasswordModal'

interface NavItem {
  to?: string;
  label: string;
  icon: any;
  roles: Role[];
  color: string;
  perm?: string | string[];
  children?: { to: string; label: string; roles: Role[]; icon: any; color: string; perm?: string | string[] }[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'reseller', 'seller'], color: 'text-blue-500', perm: 'dashboard' },
  {
    label: 'Plan',
    icon: Package,
    roles: ['admin', 'reseller', 'seller'],
    color: 'text-indigo-500',
    perm: 'view_plans',
    children: [
      { to: '/plans/hotspot', label: 'Hotspot Plans', roles: ['admin', 'reseller', 'seller'], icon: Wifi, color: 'text-sky-500' },
      { to: '/plans/pppoe', label: 'PPPOE Plans', roles: ['admin', 'reseller', 'seller'], icon: Router, color: 'text-indigo-500' },
      { to: '/plans/bandwidth', label: 'Bandwidth Plan', roles: ['admin', 'reseller', 'seller'], icon: Gauge, color: 'text-violet-500' },
    ]
  },
  { to: '/resellers', label: 'Add/View Resellers', icon: Users2, roles: ['admin'], color: 'text-purple-500', perm: 'view_resellers' },
  { to: '/sellers', label: 'Add/View Sellers', icon: Store, roles: ['admin', 'reseller'], color: 'text-amber-500', perm: 'view_sellers' },
  { to: '/ledger', label: 'Accounting & Ledger', icon: BookOpen, roles: ['admin', 'reseller', 'seller'], color: 'text-emerald-500' },
  { to: '/funds', label: 'Wallet / GB Allocation', icon: WalletIcon, roles: ['admin', 'reseller', 'seller'], color: 'text-emerald-500' },
  { to: '/vouchers', label: 'Voucher Sales', icon: Ticket, roles: ['admin', 'reseller', 'seller'], color: 'text-rose-500', perm: ['generate_voucher', 'reports'] },
  { to: '/diagnostics', label: 'Voucher Diagnostics', icon: Terminal, roles: ['admin', 'reseller', 'seller'], color: 'text-slate-600' },
  {
    label: 'Settings',
    icon: Shield,
    roles: ['admin', 'reseller', 'seller'],
    color: 'text-slate-500',
    children: [
      { to: '/settings/system-load', label: 'System Load', roles: ['admin'], icon: WalletIcon, color: 'text-emerald-500' },
      { to: '/settings/voucher-card', label: 'Voucher Card', roles: ['admin', 'reseller', 'seller'], icon: Ticket, color: 'text-rose-500' },
      { to: '/settings/api-tokens', label: 'API Tokens', roles: ['admin', 'reseller', 'seller'], icon: Key, color: 'text-indigo-500', perm: 'manage_api_tokens' },
      { to: '/settings/seasons', label: 'Season Duration', roles: ['admin'], icon: Calendar, color: 'text-amber-500' },
      { to: '/nas', label: 'NAS / Routers', roles: ['admin'], icon: Router, color: 'text-violet-500' },
      { to: '/permissions', label: 'Permissions', roles: ['admin'], icon: ShieldCheck, color: 'text-rose-600' },
      { to: '/logs', label: 'Login Logs', roles: ['admin'], icon: ShieldCheck, color: 'text-pink-500' },
    ]
  }
]

interface NavListProps {
  items: NavItem[];
  location: any;
  expanded: Record<string, boolean>;
  toggleExpanded: (label: string) => void;
  user: { role: Role; name: string };
  can: (perm?: string | string[]) => boolean;
  onNavigate?: () => void;
}

const NavList = ({ items, location, expanded, toggleExpanded, user, can, onNavigate }: NavListProps) => (
  <nav className="flex flex-col gap-1 flex-1 overflow-y-auto pr-1">
    {items.map((it) => {
      if (it.children) {
        const hasActiveChild = it.children.some((c) => location.pathname === c.to)
        return (
          <div key={it.label} className="flex flex-col">
            <button
              onClick={() => toggleExpanded(it.label)}
              className={`app-sidebar-nav-item w-full flex items-center justify-between group ${
                hasActiveChild ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item-idle'
              }`}
            >
              <div className="flex items-center gap-3">
                <it.icon size={18} className={`transition-transform group-hover:scale-110 ${it.color}`} />
                <span className="font-bold">{it.label}</span>
              </div>
              {expanded[it.label] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {expanded[it.label] && (
              <div className="pl-4 flex flex-col gap-1 mt-1 border-l border-slate-100 ml-4">
                {it.children
                  .filter((c) => c.roles.includes(user.role) && can(c.perm))
                  .map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `app-sidebar-nav-item text-sm group ${
                          isActive ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item-idle'
                        }`
                      }
                    >
                      <c.icon size={16} className={`transition-transform group-hover:scale-110 ${c.color}`} />
                      <span>{c.label}</span>
                    </NavLink>
                  ))}
              </div>
            )}
          </div>
        )
      }
      return (
        <NavLink
          key={it.to}
          to={it.to!}
          end={it.to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            `app-sidebar-nav-item group ${isActive ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item-idle'}`
          }
        >
          <it.icon size={18} className={`transition-transform group-hover:scale-110 ${it.color}`} />
          {it.label}
        </NavLink>
      )
    })}
  </nav>
)

export default function AppShell() {
  const { user, logout, can } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Plan: location.pathname.startsWith('/plans'),
    Settings: location.pathname.startsWith('/settings') || ['/nas', '/logs', '/permissions'].includes(location.pathname),
  })
  const toggleExpanded = (label: string) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }))
  }
  const [profileOpen, setProfileOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    const original = document.body.style.overflow
    if (drawerOpen) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = original }
  }, [drawerOpen])

  if (!user) return null
  // A perm can be a single feature or a list — list means "any of these grants access",
  // used where one menu item now covers what used to be two separately-gated pages.
  const canAny = (perm?: string | string[]) => !perm || (Array.isArray(perm) ? perm.some((p) => can(p)) : can(perm))
  const items = NAV
    // Hide items the role can't access OR the permission matrix has switched off.
    .filter((n) => n.roles.includes(user.role) && canAny(n.perm))
    // Drop parents whose children are all hidden by role/permission.
    .filter((n) => !n.children || n.children.some((c) => c.roles.includes(user.role) && canAny(c.perm)))

  const doLogout = async () => {
    await logout()
    nav('/login', { replace: true })
  }

  const initials = user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)

  return (
    <div className="min-h-screen bg-background md:p-4 lg:p-5 md:flex md:gap-4">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 app-sidebar-panel p-4 sticky top-4 h-[calc(100vh-2rem)]">
        <div className="flex items-center gap-3 px-2 py-2 mb-4">
          <div className="bg-[#003164] text-white rounded-2xl p-2.5 shadow-sm"><Wifi size={18} /></div>
          <div>
            <p className="font-medium text-2xl tracking-tight text-[#003164] leading-none">Airlink</p>
            <p className="text-[10px] text-slate-400 font-bold tracking-wider mt-1 uppercase">Billing v3.0</p>
          </div>
        </div>

        <NavList
          items={items}
          location={location}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          user={user}
          can={canAny}
        />

        {/* Profile Card Dropdown Container */}
        <div ref={profileRef} className="relative mt-3 pt-3 border-t border-slate-100">
          {profileOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="absolute bottom-[calc(100%+0.5rem)] left-0 w-full bg-white border border-slate-200/80 rounded-[24px] shadow-2xl p-2 z-40 flex flex-col gap-1"
            >
              <button
                onClick={() => {
                  setProfileOpen(false)
                  setPasswordOpen(true)
                }}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 text-slate-700 hover:text-slate-900 transition-all text-sm font-semibold text-left"
              >
                <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Key size={14} />
                </div>
                Change Password
              </button>

              <button
                onClick={() => {
                  setProfileOpen(false)
                  doLogout()
                }}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-rose-50/50 text-slate-700 hover:text-rose-600 transition-all text-sm font-semibold text-left"
              >
                <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <LogOut size={14} />
                </div>
                Log Out
              </button>
            </motion.div>
          )}

          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="w-full flex items-center justify-between p-2 rounded-2xl border border-slate-200/80 hover:bg-slate-50 bg-white transition-all text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 text-rose-700 flex items-center justify-center font-extrabold text-sm shrink-0 shadow-inner uppercase">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-sm text-[#003164] whitespace-normal break-words leading-tight select-none">{user.name}</p>
                <p className="text-[10px] text-slate-400 font-bold capitalize tracking-wider mt-0.5 select-none">{user.role}</p>
              </div>
            </div>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${profileOpen ? 'rotate-180' : ''} shrink-0 ml-1`} />
          </button>
        </div>
      </aside>

      {/* Mobile top app bar */}
      <header className="md:hidden sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-slate-200/70 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between gap-2 px-3 h-14">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="w-10 h-10 flex items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-[#003164] active:scale-95 transition-transform"
          >
            <Menu size={20} />
          </button>

          <div className="flex items-center gap-2">
            <div className="bg-[#003164] text-white rounded-xl p-1.5 shadow-sm"><Wifi size={15} /></div>
            <p className="font-medium text-lg tracking-tight text-[#003164] leading-none">Airlink</p>
          </div>

          {/* Separate compact badges */}
          <div className="flex items-center gap-1.5 select-none">
            {user.role !== 'seller' && (
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 rounded-xl px-2.5 h-8 flex items-center text-[11px] shadow-2xs">
                <span className="text-[10px] text-emerald-600 font-extrabold mr-1 capitalize">Wallet:</span>
                <span className="font-extrabold text-emerald-950">{rs(user.wallet_balance)}</span>
              </div>
            )}
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200/80 rounded-xl px-2.5 h-8 flex items-center text-[11px] shadow-2xs">
              <span className="text-[10px] text-purple-600 font-extrabold mr-1">GB:</span>
              <span className="font-extrabold text-purple-950">{gb(user.gb_balance)}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile drawer + backdrop */}
      <AnimatePresence>
        {drawerOpen && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setDrawerOpen(false)}
            className="md:hidden fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm"
          />
        )}
        {drawerOpen && (
          <motion.aside
            key="drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.26, ease: 'easeOut' }}
            className="md:hidden fixed top-0 left-0 z-[60] h-[100dvh] w-[82%] max-w-xs bg-white border-r border-slate-200 shadow-2xl flex flex-col p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3 px-1">
                  <div className="bg-[#003164] text-white rounded-2xl p-2.5 shadow-sm"><Wifi size={18} /></div>
                  <div>
                    <p className="font-medium text-2xl tracking-tight text-[#003164] leading-none">Airlink</p>
                    <p className="text-[10px] text-slate-400 font-bold tracking-wider mt-1 uppercase">Billing v3.0</p>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="w-9 h-9 flex items-center justify-center rounded-full border border-slate-200 text-slate-500 active:scale-95 transition-transform"
                >
                  <X size={18} />
                </button>
              </div>

              <NavList
                items={items}
                location={location}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                user={user}
                can={canAny}
                onNavigate={() => setDrawerOpen(false)}
              />

              {/* Drawer profile actions */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
                <div className="flex items-center gap-2.5 p-2 rounded-2xl border border-slate-200/80 bg-white">
                  <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 text-rose-700 flex items-center justify-center font-extrabold text-sm shrink-0 shadow-inner uppercase">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-sm text-[#003164] break-words leading-tight">{user.name}</p>
                    <p className="text-[10px] text-slate-400 font-bold capitalize tracking-wider mt-0.5">{user.role}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => { setDrawerOpen(false); setPasswordOpen(true) }}
                    className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold active:scale-95 transition-transform"
                  >
                    <Key size={14} className="text-rose-500" /> Password
                  </button>
                  <button
                    onClick={() => { setDrawerOpen(false); doLogout() }}
                    className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-rose-100 bg-rose-50/50 text-rose-600 text-xs font-bold active:scale-95 transition-transform"
                  >
                    <LogOut size={14} /> Log Out
                  </button>
                </div>
              </div>
            </motion.aside>
        )}
      </AnimatePresence>

      {/* Main */}
      <div className="flex-1 min-w-0 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 md:p-0">
        <motion.main initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Outlet />
        </motion.main>
      </div>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  )
}
