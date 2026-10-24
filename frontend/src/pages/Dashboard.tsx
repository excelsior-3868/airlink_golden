import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, Terminal } from 'lucide-react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { useQuery } from '../lib/cache'
import { PageTitle, Spinner } from '../components/ui'
import NetworkDashboard from '../components/NetworkDashboard'

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: d, loading } = useQuery<any>(
    'dashboard',
    () => api.get('/dashboard').then((r) => r.data.data),
  )

  if (loading || !d) return <Spinner />

  return (
    <div>
      <PageTitle
        title="Dashboard"
        subtitle={`${d.role.charAt(0).toUpperCase() + d.role.slice(1)} network & subscriber overview`}
        icon={<LayoutDashboard size={22} className="text-blue-500" />}
        showOnlineUsers={true}
        action={
          <div className="flex items-center divide-x divide-slate-200 dark:divide-slate-700 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto max-w-full shadow-sm">
            <motion.button
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-500 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-white transition-colors whitespace-nowrap"
              onClick={() => navigate('/diagnostics')}
            >
              <Terminal size={16} className="text-slate-400 dark:text-slate-400" /> Customer Diagnostic
            </motion.button>
          </div>
        }
      />

      {d.network_metrics && <NetworkDashboard metrics={d.network_metrics} role={d.role} />}
    </div>
  )
}
