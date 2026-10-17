import axios from 'axios'

export const nmsApi = axios.create({
  baseURL: '/api/nms/v1',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

nmsApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('airlink_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

nmsApi.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && !location.pathname.includes('/login')) {
      localStorage.removeItem('airlink_token')
      location.href = '/login'
    }
    return Promise.reject(error)
  },
)

export const errMsg = (e: unknown): string => {
  const ax = e as {
    response?: {
      data?: { error?: string; message?: string } | string
      status?: number
    }
    message?: string
  }
  const data = ax.response?.data
  if (typeof data === 'object' && data !== null) {
    if ('error' in data && data.error) return data.error
    if ('message' in data && data.message) return data.message
  }
  if (typeof data === 'string' && data.trim()) {
    if (!data.includes('<html') && !data.includes('<!DOCTYPE')) {
      return data.trim()
    }
  }
  if (ax.response?.status === 502) {
    return 'Gateway error (502): The OLT or service is currently unreachable or busy. Please retry in a few moments.'
  }
  return ax.message ?? 'Request failed'
}

export type Role = 'admin' | 'operator' | 'viewer'
export const rank: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 }

export interface Device {
  id: number
  name: string
  ip: string
  role: string
  vendor: string
  pop_id: number | null
  pop: string | null
  parent_id: number | null
  poll_method: string
  status: 'up' | 'down' | 'unknown'
  status_since: string
  last_polled_at: string | null
  sys_descr: string
  uptime_seconds: number | null
  cpu_pct: number | null
  mem_pct: number | null
  enabled: boolean
  vlan?: number | null
  gem_port?: number | null
  gem_port_untagged?: number | null
  default_tag_mode?: 'tagged' | 'untagged' | null
  line_profile_id?: number | null
  srv_profile_id?: number | null
  line_profile_id_untagged?: number | null
  srv_profile_id_untagged?: number | null
  reseller_ids?: string | null
}

export interface Alert {
  id: number
  severity: 'P1' | 'P2' | 'P3'
  title: string
  detail: string
  state: 'open' | 'acknowledged' | 'resolved'
  device_id: number | null
  device: string | null
  suppressed_by: number | null
  opened_at: string
  acknowledged_at: string | null
  acknowledged_by: string | null
  resolved_at: string | null
  resolution_note: string
}

export interface Iface {
  id: number
  name: string
  alias: string
  speed_bps: number
  monitored: boolean
  oper_status: string
  in_bps: number | null
  out_bps: number | null
  util_pct: number | null
  in_errors: number
  out_errors: number
}

export interface Summary {
  devices: { total: number; up: number; down: number; unknown: number }
  alerts: { p1: number; p2: number; p3: number; unacknowledged: number; suppressed: number }
  onts: { total: number; online: number; not_online: number }
  mtta: { seconds: number }
  pops: { id: number; name: string; devices: number; down: number }[]
  top_interfaces: { id: number; device: string; name: string; speed_bps: number; in_bps: number; out_bps: number; util_pct: number }[]
}

export interface Olt {
  id: number
  name: string
  ip: string
  status: string
  software_version: string
  pon_ports: string
  host_key_pinned: boolean
  protocol?: 'ssh' | 'telnet'
  ssh_port?: number
  login_user?: string
  has_password?: boolean
  onts: number
  onts_online: number
  detected_version?: string
  detected_patch?: string
  last_sync_at?: string | null
  vlan?: number | null
  gem_port?: number | null
  gem_port_untagged?: number | null
  default_tag_mode?: 'tagged' | 'untagged' | null
  line_profile_id?: number | null
  srv_profile_id?: number | null
  line_profile_id_untagged?: number | null
  srv_profile_id_untagged?: number | null
  reseller_ids?: string | null
}

export interface Ont {
  id: number
  serial_number: string
  frame: number
  slot: number
  pon_port: number
  ont_id: number
  description: string
  run_state: string
  config_state: string
  match_state: string
  rx_power_dbm: number | null
  last_seen_at: string | null
  reseller_id?: number | null
  reseller_username?: string
  reseller_name?: string
}

export interface Template {
  id: number
  name: string
  service_vlan: number
  user_vlan: number
  gem_index: number
  tag_transform: string
  line_profile_id: number
  srv_profile_id: number
  enabled?: boolean
}

export interface OltProfile {
  id: number
  profile_type: string
  profile_id: number
  profile_name: string
  verified_at: string
}

export interface JobStep {
  seq: number
  name: string
  kind: string
  commands: string[]
  rollback_commands: string[] | null
  expect: string
  result: string
  output: string
  plan_result?: string
  plan_output?: string
}

export interface Job {
  id: number
  olt_id: number
  operation: string
  status: string
  requested_by: string
  approved_by: string | null
  before_state: string
  error_summary: string
  created_at: string
  completed_at: string | null
  saved_at?: string | null
  saved_by?: string | null
  params: Record<string, unknown>
  steps?: JobStep[]
}
