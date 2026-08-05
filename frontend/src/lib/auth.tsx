import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api } from './api'
import { invalidateCache } from './cache'

export type Role = 'admin' | 'reseller' | 'seller'

export interface AuthUser {
  id: number
  name: string
  username: string
  email: string | null
  role: Role
  parent_id: number | null
  wallet_balance: string
  gb_balance: string
  gb_reserved?: number | string
  gb_allowable?: number | string
  status: string
  must_reset_password: boolean
  permissions: Record<string, boolean>
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  can: (feature?: string) => boolean
}

const AuthContext = createContext<AuthState>(null as any)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!localStorage.getItem('airlink_token')) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const { data } = await api.get('/me')
      setUser(data.data)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const login = async (username: string, password: string) => {
    const { data } = await api.post('/login', { username, password })
    // The page-data cache (lib/cache.ts) keys entries by resource name only, not
    // by user — without this, switching accounts without a full reload would
    // flash the previous user's cached dashboard/lists (wrong balances, wrong
    // role's cards) until each query's staleTime happened to expire.
    invalidateCache()
    localStorage.setItem('airlink_token', data.data.token)
    setUser(data.data.user)
  }

  const logout = async () => {
    try {
      await api.post('/logout')
    } catch {
      /* ignore */
    }
    localStorage.removeItem('airlink_token')
    setUser(null)
    invalidateCache()
  }

  // Feature-level gate driven by the server permission matrix. No feature => always
  // allowed. If permissions are missing (legacy token), fall back to allowed so the
  // menu still renders and role checks remain the effective guard.
  const can = (feature?: string) => {
    if (!feature) return true
    if (!user?.permissions) return true
    return user.permissions[feature] === true
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh, can }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
