import axios from 'axios'

let API_URL = import.meta.env.VITE_API_URL || '/api'

if (typeof window !== 'undefined') {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    // When loaded on a domain (like https://airlink.netcarenepal.com), always use
    // relative '/api' so requests match the page's scheme (HTTPS) and route through Nginx.
    API_URL = '/api'
  } else if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
    try {
      const url = new URL(API_URL)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        url.hostname = window.location.hostname
        API_URL = url.toString()
      }
    } catch (e) {
      /* ignore */
    }
  }
}

export const api = axios.create({
  baseURL: API_URL,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

// Attach the bearer token on every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('airlink_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Kick to login on 401.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && !location.pathname.includes('/login')) {
      localStorage.removeItem('airlink_token')
      location.href = '/login'
    }
    return Promise.reject(error)
  },
)

/** Pull a human message out of our {success,message,errors} envelope. */
export function apiError(e: any): string {
  const d = e?.response?.data
  if (d?.errors) return Object.values(d.errors).flat()[0] as string
  return d?.message || e?.message || 'Something went wrong.'
}

export const API_BASE = API_URL
