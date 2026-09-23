const API_ROOT = import.meta.env.VITE_API_URL || ''
export const getToken = () => {
  localStorage.removeItem('inventory_access_token')
  localStorage.removeItem('inventory_refresh_token')
  return sessionStorage.getItem('inventory_access_token')
}
export const setSession = (access: string) => {
  sessionStorage.setItem('inventory_access_token', access)
  localStorage.removeItem('inventory_access_token')
  localStorage.removeItem('inventory_refresh_token')
}
export const clearSession = () => {
  sessionStorage.removeItem('inventory_access_token')
  localStorage.removeItem('inventory_access_token')
  localStorage.removeItem('inventory_refresh_token')
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getToken(); if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error?.message || payload?.detail || 'The request could not be completed.')
  return payload as T
}
