import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  LayoutDashboard, Package, Users2, Store, Wallet as WalletIcon,
  Database, Ticket, LogOut, Wifi, Router, ShieldCheck, Shield,
  ChevronDown, ChevronRight, ChevronsLeft, Key, Gauge, ArrowLeftRight, Menu, X, Terminal, Calendar,
  BookOpen, Receipt, Scale, CreditCard, UsersRound, Palette
} from 'lucide-react'
import { Role, useAuth } from '../lib/auth'
import { useBranding } from '../lib/branding'
import { rs, gb } from '../lib/format'
import ChangePasswordModal from '../components/ChangePasswordModal'

// The panel's two widths, and the page offsets that track them. The rail is
// sized so a 44px logo tile and a 40px avatar both land centered while the nav
// icons keep the same x they have when open — the edge travels, the icons don't.
const SIDEBAR_FULL = 256
const SIDEBAR_RAIL = 68
const CONTENT_OFFSET_FULL = '17rem'      // 16px gutter + 256px panel
const CONTENT_OFFSET_RAIL = '5.25rem'    // 16px gutter + 68px panel

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
  { to: '/financial-dashboard', label: 'Financial Dashboard', icon: Scale, roles: ['admin', 'reseller', 'seller'], color: 'text-blue-600' },
  { to: '/online-users', label: 'Online Users', icon: UsersRound, roles: ['admin', 'reseller', 'seller'], color: 'text-cyan-500' },
  {
    label: 'Plan',
    icon: Package,
    roles: ['admin'],
    color: 'text-indigo-500',
    perm: 'view_plans',
    children: [
      { to: '/plans/hotspot', label: 'Hotspot Plans', roles: ['admin'], icon: Wifi, color: 'text-sky-500' },
      { to: '/plans/bandwidth', label: 'Bandwidth Plans', roles: ['admin'], icon: Gauge, color: 'text-violet-500' },
    ]
  },
  { to: '/plans/hotspot', label: 'Hotspot Plans', icon: Wifi, roles: ['reseller', 'seller'], color: 'text-sky-500', perm: 'view_plans' },
  {
    label: 'PPPoE',
    icon: Router,
    roles: ['admin', 'reseller'],
    color: 'text-indigo-500',
    perm: ['view_pppoe', 'view_plans'],
    children: [
      { to: '/pppoe/customers', label: 'Subscribers', roles: ['admin', 'reseller'], icon: Users2, color: 'text-indigo-500', perm: 'view_pppoe' },
      { to: '/plans/pppoe', label: 'PPPoE Plans', roles: ['admin', 'reseller'], icon: Package, color: 'text-violet-500', perm: 'view_plans' },
    ]
  },
  { to: '/resellers', label: 'Add/View Resellers', icon: Users2, roles: ['admin'], color: 'text-purple-500', perm: 'view_resellers' },
  { to: '/sellers', label: 'Add/View Sellers', icon: Store, roles: ['admin', 'reseller'], color: 'text-amber-500', perm: 'view_sellers' },
  { to: '/funds', label: 'Wallet / GB Allocation', icon: WalletIcon, roles: ['admin', 'reseller', 'seller'], color: 'text-emerald-500' },
  { to: '/vouchers', label: 'Voucher Sales', icon: Ticket, roles: ['admin', 'reseller', 'seller'], color: 'text-rose-500', perm: ['generate_voucher', 'reports'] },
  { to: '/diagnostics', label: 'Voucher Diagnostics', icon: Terminal, roles: ['admin', 'reseller', 'seller'], color: 'text-slate-600' },
  { to: '/ledger', label: 'Accounting & Ledger', icon: BookOpen, roles: ['admin', 'reseller', 'seller'], color: 'text-emerald-500' },
  {
    label: 'Settings',
    icon: Shield,
    roles: ['admin', 'reseller', 'seller'],
    color: 'text-slate-500',
    children: [
      { to: '/settings/branding', label: 'Branding', roles: ['admin', 'reseller', 'seller'], icon: Palette, color: 'text-indigo-500' },
      { to: '/settings/payment-methods', label: 'Payment Methods', roles: ['admin'], icon: CreditCard, color: 'text-sky-500' },
      { to: '/settings/chart-of-accounts', label: 'Chart of Accounts', roles: ['admin'], icon: BookOpen, color: 'text-emerald-600' },
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
  /** Icon rail: the panel clips its own labels, so nothing here changes shape. */
  collapsed?: boolean;
  /** Reopens the panel when a collapsed parent item is clicked. */
  onExpandSidebar?: () => void;
}

// One markup path serves both states. Icons are `shrink-0` and labels are
// `flex-1 min-w-0`, so the panel's own width animation squeezes every label out
// on the same curve — no per-item layout animation, and no element swap that
// could pop mid-transition.
const NavList = ({ items, location, expanded, toggleExpanded, user, can, onNavigate, collapsed = false, onExpandSidebar }: NavListProps) => (
  <nav className="flex flex-col gap-1 flex-1 overflow-y-auto overflow-x-hidden">
    {items.map((it) => {
      const label = it.to === '/funds' && user.role !== 'admin' ? 'GB Allocation' : it.label
      const fade = collapsed ? 'app-sidebar-label-out' : 'app-sidebar-label-in'
      const labelClass = `app-sidebar-label ${fade} min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left`

      if (it.children) {
        const hasActiveChild = it.children.some((c) => location.pathname === c.to)
        const open = !!expanded[it.label] && !collapsed

        return (
          <div key={it.label} className="flex flex-col">
            <button
              onClick={() => {
                // The rail has no room for a nested list: reopen the panel and
                // let the group unfold inside it.
                if (collapsed) {
                  onExpandSidebar?.()
                  if (!expanded[it.label]) toggleExpanded(it.label)
                  return
                }
                toggleExpanded(it.label)
              }}
              title={collapsed ? label : undefined}
              aria-label={collapsed ? label : undefined}
              aria-expanded={open}
              className={`app-sidebar-nav-item w-full group ${
                hasActiveChild ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item-idle'
              }`}
            >
              <it.icon size={18} className={`shrink-0 transition-transform group-hover:scale-110 ${it.color}`} />
              <span className={labelClass}>{label}</span>
              {/* No `transition-transform` here — the utility layer would beat
                  .app-sidebar-label and the fade would pop. That class already
                  transitions transform and opacity together. */}
              <ChevronRight size={14} className={`app-sidebar-label ${fade} shrink-0 ${open ? 'rotate-90' : ''}`} />
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="submenu"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
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
                          <c.icon size={16} className={`shrink-0 transition-transform group-hover:scale-110 ${c.color}`} />
                          <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">{c.label}</span>
                        </NavLink>
                      ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      }
      return (
        <NavLink
          key={it.to}
          to={it.to!}
          end={it.to === '/'}
          onClick={onNavigate}
          title={collapsed ? label : undefined}
          aria-label={collapsed ? label : undefined}
          className={({ isActive }) =>
            `app-sidebar-nav-item w-full group ${
              isActive ? 'app-sidebar-nav-item-active' : 'app-sidebar-nav-item-idle'
            }`
          }
        >
          <it.icon size={18} className={`shrink-0 transition-transform group-hover:scale-110 ${it.color}`} />
          <span className={labelClass}>{label}</span>
        </NavLink>
      )
    })}
  </nav>
)

export default function AppShell() {
  const { user, logout, can } = useAuth()
  const { branding } = useBranding()
  const nav = useNavigate()
  const location = useLocation()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Plan: location.pathname.startsWith('/plans') && location.pathname !== '/plans/pppoe',
    PPPoE: location.pathname.startsWith('/pppoe') || location.pathname === '/plans/pppoe',
    Settings: location.pathname.startsWith('/settings') || ['/nas', '/logs', '/permissions'].includes(location.pathname),
  })
  const toggleExpanded = (label: string) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }))
  }
  const [profileOpen, setProfileOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Desktop sidebar collapsed to an icon-only rail. Persisted so the choice
  // survives reloads — the mobile drawer is unaffected.
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem('airlink_sidebar_collapsed') === '1')
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('airlink_sidebar_collapsed', collapsed ? '1' : '0')
  }, [collapsed])

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
      {/* Desktop Sidebar (Fixed) */}
      <aside
        style={{ width: collapsed ? SIDEBAR_RAIL : SIDEBAR_FULL }}
        className="app-sidebar-panel app-sidebar-motion hidden md:flex flex-col shrink-0 px-3 py-4 fixed top-4 left-4 lg:left-5 h-[calc(100vh-2rem)] z-30"
      >
        {/* Mounted on the panel's edge, so it rides the collapse instead of
            jumping to a new home when the layout changes. */}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-expanded={!collapsed}
          className="absolute -right-3 top-[34px] z-40 w-6 h-6 rounded-full bg-white border border-slate-200/90 text-slate-400 shadow-sm flex items-center justify-center hover:text-[#003164] hover:border-slate-300 hover:scale-110 active:scale-95 transition-all duration-200"
        >
          <ChevronsLeft size={13} className={`transition-transform duration-300 ease-out ${collapsed ? 'rotate-180' : ''}`} />
        </button>

        <div className="mb-4 flex items-center gap-3 py-2">
          <div className="bg-[#003164] text-white rounded-2xl p-2 shadow-sm shrink-0 w-10 h-10 flex items-center justify-center overflow-hidden">
            {branding.logo_url ? (
              <img src={branding.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <Wifi size={18} />
            )}
          </div>
          <div className={`app-sidebar-label ${collapsed ? 'app-sidebar-label-out' : 'app-sidebar-label-in'} min-w-0 flex-1 overflow-hidden`}>
            <p className="font-extrabold text-lg tracking-tight text-[#003164] leading-none whitespace-nowrap overflow-hidden text-ellipsis">
              {branding.property_name || 'Airlink'}
            </p>
            <p className="text-[10px] text-slate-400 font-bold tracking-wider mt-1 uppercase whitespace-nowrap">Billing v3.0</p>
          </div>
        </div>

        <NavList
          items={items}
          location={location}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
          user={user}
          can={canAny}
          collapsed={collapsed}
          onExpandSidebar={() => setCollapsed(false)}
        />

        {/* Profile Card Dropdown Container */}
        <div ref={profileRef} className="relative mt-3 pt-3 border-t border-slate-100">
          {profileOpen && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`absolute bottom-[calc(100%+0.5rem)] left-0 bg-white border border-slate-200/80 rounded-[24px] shadow-2xl p-2 z-40 flex flex-col gap-1 ${
                collapsed ? 'w-56' : 'w-full'
              }`}
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
            title={collapsed ? `${user.name} (${user.role})` : undefined}
            className={`app-sidebar-profile w-full flex items-center gap-2.5 py-2 rounded-2xl border text-left ${
              collapsed
                ? 'px-px border-transparent bg-transparent'
                : 'px-2 border-slate-200/80 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-rose-50 border border-rose-100 text-rose-700 flex items-center justify-center font-extrabold text-sm shrink-0 shadow-inner uppercase">
              {initials}
            </div>
            <div className={`app-sidebar-label ${collapsed ? 'app-sidebar-label-out' : 'app-sidebar-label-in'} min-w-0 flex-1 overflow-hidden`}>
              <p className="font-extrabold text-sm text-[#003164] truncate leading-tight select-none">{user.name}</p>
              <p className="text-[10px] text-slate-400 font-bold capitalize tracking-wider mt-0.5 select-none">{user.role}</p>
            </div>
            <ChevronDown
              size={14}
              className={`app-sidebar-label ${collapsed ? 'app-sidebar-label-out' : 'app-sidebar-label-in'} text-slate-400 shrink-0 ${
                profileOpen ? 'rotate-180' : ''
              }`}
            />
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
            <div className="bg-[#003164] text-white rounded-xl p-1 shadow-sm w-7 h-7 flex items-center justify-center overflow-hidden">
              {branding.logo_url ? <img src={branding.logo_url} alt="Logo" className="w-full h-full object-contain" /> : <Wifi size={14} />}
            </div>
            <p className="font-extrabold text-base tracking-tight text-[#003164] leading-none">{branding.property_name || 'Airlink'}</p>
          </div>

          {/* Compact balance badges — icon substitutes for the label so large
              values (Rs 900,000+) never wrap inside the pill on narrow phones. */}
          <div className="flex items-center gap-1.5 select-none min-w-0">
            {user.role !== 'seller' && (
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200/80 rounded-xl px-2 h-8 flex items-center gap-1 text-[11px] shadow-2xs shrink-0">
                <WalletIcon size={12} className="text-emerald-600 shrink-0" />
                <span className="font-extrabold text-emerald-950 whitespace-nowrap">{rs(user.wallet_balance)}</span>
              </div>
            )}
            <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200/80 rounded-xl px-2 h-8 flex items-center gap-1 text-[11px] shadow-2xs shrink-0">
              <Database size={12} className="text-purple-600 shrink-0" />
              <span className="font-extrabold text-purple-950 whitespace-nowrap">{gb(user.gb_balance)}</span>
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
                  <div className="bg-[#003164] text-white rounded-2xl p-2 shadow-sm shrink-0 w-10 h-10 flex items-center justify-center overflow-hidden">
                    {branding.logo_url ? <img src={branding.logo_url} alt="Logo" className="w-full h-full object-contain" /> : <Wifi size={18} />}
                  </div>
                  <div>
                    <p className="font-extrabold text-lg tracking-tight text-[#003164] leading-none">{branding.property_name || 'Airlink'}</p>
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
      {/* The offset is a CSS variable so it only applies from md up (the drawer
          layout below md keeps a zero margin) while still transitioning on the
          same curve as the panel edge. */}
      <div
        style={{ ['--app-sidebar-offset' as string]: collapsed ? CONTENT_OFFSET_RAIL : CONTENT_OFFSET_FULL } as React.CSSProperties}
        className="app-content-motion flex-1 min-w-0 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 md:p-0 md:ml-[var(--app-sidebar-offset)]"
      >
        <motion.main initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Outlet />
        </motion.main>
      </div>


      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  )
}
