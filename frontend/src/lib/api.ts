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
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  } catch {
    throw new Error('Unable to reach the Stockwise server. Please check that the backend is running and try again.')
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message || (typeof payload?.error === 'string' ? payload.error : null) || payload?.detail || payload?.message
    throw new Error(message || (response.status === 429 ? 'Too many sign-in attempts. Wait a minute, then try again.' : `The request failed (${response.status}). Please try again.`))
  }
  return payload as T
}
