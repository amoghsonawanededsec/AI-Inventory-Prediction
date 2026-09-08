import { useEffect, useState } from 'react'
import Layout, { type PageKey } from './components/Layout'
import { api, clearSession, getToken } from './lib/api'
import type { User } from './types'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProductsPage from './pages/ProductsPage'
import DataPage from './pages/DataPage'
import ChatPage from './pages/ChatPage'

function App() {
  const [user, setUser] = useState<User | null>(null), [page, setPage] = useState<PageKey>('dashboard'), [checking, setChecking] = useState(Boolean(getToken()))
  useEffect(() => { if (!getToken()) return; api<User>('/api/auth/me').then(setUser).catch(clearSession).finally(() => setChecking(false)) }, [])
  const logout = () => { clearSession(); setUser(null); setPage('dashboard') }
  if (checking) return <div className="boot-screen">Connecting securely to Stockwise AI…</div>
  if (!user) return <LoginPage onLogin={setUser}/>
  let view: React.ReactNode
  if (page === 'dashboard') view = <DashboardPage/>
  else if (page === 'products') view = <ProductsPage/>
  else if (page === 'chat') view = <ChatPage/>
  else view = <DataPage kind={page}/>
  return <Layout page={page} setPage={setPage} user={user} onLogout={logout}>{view}</Layout>
}
export default App
