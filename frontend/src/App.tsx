import { Navigate, Route, Routes, Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Role, useAuth } from './lib/auth'
import AppShell from './layouts/AppShell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import HotspotPlans from './pages/HotspotPlans'
import PppoePlans from './pages/PppoePlans'
import Bandwidths from './pages/Bandwidths'
import Users from './pages/Users'
import FundAllocation from './pages/FundAllocation'
import Transactions from './pages/Transactions'
import Vouchers from './pages/Vouchers'
import Nas from './pages/Nas'
import LoginLogs from './pages/LoginLogs'
import Permissions from './pages/Permissions'
import SystemLoad from './pages/SystemLoad'
import VoucherGenerator from './pages/VoucherGenerator'
import VoucherCardDesigner from './pages/VoucherCardDesigner'
import RadiusLogs from './pages/RadiusLogs'
import SeasonDuration from './pages/SeasonDuration' // force rebuild to resolve import
import SalesLedger from './pages/SalesLedger'
import ExpensesLedger from './pages/ExpensesLedger'
import Ledger from './pages/Ledger'
import ApiTokens from './pages/ApiTokens'
import FinancialDashboard from './pages/FinancialDashboard'
import ChartOfAccounts from './pages/ChartOfAccounts'
import PaymentMethods from './pages/PaymentMethods'

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 gap-3">
      <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-100 text-rose-500 flex items-center justify-center">
        <Lock size={26} />
      </div>
      <h2 className="text-xl font-extrabold text-slate-800">Access Restricted</h2>
      <p className="text-sm text-slate-500 max-w-sm">
        You do not have permission to view this page. This access is controlled by system policy.
      </p>
      <Link to="/" className="btn-primary py-2 px-5 rounded-2xl font-bold mt-2">Back to Dashboard</Link>
    </div>
  )
}

// Route-level gate — mirrors the sidebar's role/permission rules so a direct URL
// cannot bypass a hidden menu item.
function Guard({ perm, roles, children }: { perm?: string | string[]; roles?: Role[]; children: JSX.Element }) {
  const { user, can } = useAuth()
  if (!user) return null
  const roleOk = !roles || roles.includes(user.role)
  // A perm list means "any of these grants access" — used where one page now covers
  // what used to be two separately-gated routes.
  const permOk = !perm || (Array.isArray(perm) ? perm.some((p) => can(p)) : can(perm))
  if (!roleOk || !permOk) return <AccessDenied />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<Guard perm="dashboard"><Dashboard /></Guard>} />
        <Route path="/financial-dashboard" element={<Guard roles={['admin', 'reseller', 'seller']}><FinancialDashboard /></Guard>} />
        <Route path="/plans" element={<Navigate to="/plans/hotspot" replace />} />
        <Route path="/plans/hotspot" element={<Guard perm="view_plans"><HotspotPlans /></Guard>} />
        <Route path="/plans/pppoe" element={<Guard perm="view_plans"><PppoePlans /></Guard>} />
        <Route path="/plans/bandwidth" element={<Guard perm="view_plans"><Bandwidths /></Guard>} />
        <Route path="/resellers" element={<Guard perm="view_resellers" roles={['admin']}><Users role="reseller" /></Guard>} />
        <Route path="/sellers" element={<Guard perm="view_sellers" roles={['admin', 'reseller']}><Users role="seller" /></Guard>} />
        <Route path="/wallet" element={<Guard roles={['admin', 'reseller', 'seller']}><FundAllocation defaultTab="wallet" /></Guard>} />
        <Route path="/gb" element={<Guard roles={['admin', 'reseller', 'seller']}><FundAllocation defaultTab="gb" /></Guard>} />
        <Route path="/funds" element={<Guard roles={['admin', 'reseller', 'seller']}><FundAllocation /></Guard>} />
        <Route path="/ledger" element={<Guard roles={['admin', 'reseller', 'seller']}><Ledger /></Guard>} />
        <Route path="/accounts/sales" element={<Navigate to="/ledger?tab=sales" replace />} />
        <Route path="/accounts/expenses" element={<Navigate to="/ledger?tab=expenses" replace />} />
        <Route path="/transactions" element={<Navigate to="/ledger?tab=transactions" replace />} />
        <Route path="/vouchers" element={<Guard perm={['generate_voucher', 'reports']}><Vouchers /></Guard>} />
        <Route path="/vouchers/generate" element={<Guard perm="generate_voucher"><VoucherGenerator /></Guard>} />
        <Route path="/reports" element={<Navigate to="/vouchers?tab=vouchers" replace />} />
        <Route path="/diagnostics" element={<Guard roles={['admin', 'reseller', 'seller']}><RadiusLogs /></Guard>} />
        <Route path="/nas" element={<Guard perm="view_settings" roles={['admin']}><Nas /></Guard>} />
        <Route path="/logs" element={<Guard perm="view_settings" roles={['admin']}><LoginLogs /></Guard>} />
        <Route path="/permissions" element={<Guard perm="view_settings" roles={['admin']}><Permissions /></Guard>} />
        <Route path="/settings/payment-methods" element={<Guard perm="view_settings" roles={['admin']}><PaymentMethods /></Guard>} />
        <Route path="/settings/chart-of-accounts" element={<Guard roles={['admin']}><ChartOfAccounts /></Guard>} />
        <Route path="/settings/system-load" element={<Guard perm="view_settings" roles={['admin']}><SystemLoad /></Guard>} />
        <Route path="/settings/voucher-card" element={<Guard roles={['admin', 'reseller', 'seller']}><VoucherCardDesigner /></Guard>} />
        <Route path="/settings/api-tokens" element={<Guard perm="manage_api_tokens" roles={['admin', 'reseller', 'seller']}><ApiTokens /></Guard>} />
        <Route path="/settings/seasons" element={<Guard perm="view_settings" roles={['admin']}><SeasonDuration /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

