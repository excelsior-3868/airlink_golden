export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function bps(v: number | null | undefined): string {
  if (v == null) return '-'
  const u = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']
  let i = 0
  let n = v
  while (n >= 1000 && i < u.length - 1) {
    n /= 1000
    i++
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`
}

export function pct(v: number | null | undefined): string {
  return v == null ? '-' : `${v.toFixed(1)}%`
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '-'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function duration(sec: number | null | undefined): string {
  if (sec == null) return '-'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
