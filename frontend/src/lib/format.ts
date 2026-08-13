import { adToBs, formatBsString } from './nepaliDate'

export const rs = (n: number | string) =>
  'Rs ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const gb = (n: number | string) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' GB'

export const formatBytes = (bytes: number | string): string => {
  const b = Number(bytes) || 0
  if (b === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(b) / Math.log(k))
  const index = Math.min(i, sizes.length - 1)
  const val = b / Math.pow(k, index)
  return `${val.toLocaleString('en-US', { maximumFractionDigits: val >= 100 ? 1 : 2 })} ${sizes[index]}`
}

export const num = (n: number | string) => Number(n).toLocaleString('en-US')

const TZ = 'Asia/Kathmandu'

// Everything is stored UTC (Laravel's app.timezone, and FreeRADIUS via FROM_UNIXTIME
// inside the UTC mariadb container). Eloquent serializes with a trailing Z, but raw
// DB::table() selects — radacct session times especially — come back as bare
// "2026-08-07 09:58:15", which JS parses as *browser-local* and so renders 5h45m
// early in Nepal. Tag those as UTC before formatting, then pin output to NPT so the
// display doesn't drift with whatever timezone the viewer's machine is set to.
const NAIVE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/
export const parseDate = (s: string) => new Date(NAIVE.test(s) ? s.replace(' ', 'T') + 'Z' : s)

export const datet = (s: string | null) => (s ? parseDate(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : '—')
export const date = (s: string | null) => (s ? parseDate(s).toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: TZ }) : '—')

export const bsDate = (s: string | null): string => {
  if (!s) return '—'
  const d = parseDate(s)
  if (isNaN(d.getTime())) return '—'
  const bs = adToBs(d)
  return bs ? formatBsString(bs.bsYear, bs.bsMonth, bs.bsDay, 'en') : '—'
}

export const statusPill: Record<string, string> = {
  new: 'info',
  used: 'info',
  sold: 'warning',
  active: 'success',
  expired: 'secondary',
  disabled: 'danger',
  activate: 'success',
  suspended: 'warning',
  pending: 'secondary',
  terminated: 'danger',
}
