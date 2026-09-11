import { useEffect, useState } from 'react'
import Layout, { type PageKey } from './components/Layout'
import { api, clearSession, getToken } from './lib/api'
import type { User } from './types'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProductsPage from './pages/ProductsPage'
import DataPage from './pages/DataPage'
import ChatPage from './pages/ChatPage'

import ErrorBoundary from './components/ErrorBoundary'

const VALID_PAGES: PageKey[] = [
  'dashboard', 'products', 'inventory', 'sales', 'forecasts',
  'waste', 'reorders', 'orders', 'suppliers', 'analytics',
  'chat', 'knowledge', 'models', 'users', 'settings'
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [page, setPageState] = useState<PageKey>(() => {
    const hash = window.location.hash.replace(/^#\/?/, '') as PageKey
    return VALID_PAGES.includes(hash) ? hash : 'dashboard'
  })
  const [checking, setChecking] = useState(Boolean(getToken()))

  const setPage = (newPage: PageKey) => {
    setPageState(newPage)
    window.location.hash = newPage
  }

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '') as PageKey
      if (VALID_PAGES.includes(hash)) {
        setPageState(hash)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!getToken()) return
    api<User>('/api/auth/me')
      .then(setUser)
      .catch(clearSession)
      .finally(() => setChecking(false))
  }, [])

  const logout = () => {
    clearSession()
    setUser(null)
    setPage('dashboard')
  }

  if (checking) return <div className="boot-screen">Connecting securely to Stockwise AI…</div>
  if (!user) return <LoginPage onLogin={setUser}/>

  let view: React.ReactNode
  if (page === 'dashboard') view = <DashboardPage onNavigate={setPage}/>
  else if (page === 'products') view = <ProductsPage/>
  else if (page === 'chat') view = <ChatPage/>
  else view = <DataPage kind={page}/>

  return (
    <Layout page={page} setPage={setPage} user={user} onLogout={logout}>
      <ErrorBoundary>
        {view}
      </ErrorBoundary>
    </Layout>
  )
}

export default App
