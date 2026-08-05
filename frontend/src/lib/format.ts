export const rs = (n: number | string) =>
  'Rs ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const gb = (n: number | string) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 }) + ' GB'

export const num = (n: number | string) => Number(n).toLocaleString('en-US')

export const datet = (s: string | null) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
export const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : '—')

export const statusPill: Record<string, string> = {
  new: 'info',
  used: 'info',
  sold: 'warning',
  active: 'success',
  expired: 'secondary',
  disabled: 'danger',
  activate: 'success',
}
