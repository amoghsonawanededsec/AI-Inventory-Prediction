import { useEffect, useState } from 'react'
import Layout, { type PageKey } from './components/Layout'
import { api, clearSession, getToken } from './lib/api'
import type { User } from './types'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import ProductsPage from './pages/ProductsPage'
import DataPage from './pages/DataPage'
import ChatPage from './pages/ChatPage'
import DataInputPage from './pages/DataInputPage'
import SignupPage from './pages/SignupPage'
import AdminPage from './pages/AdminPage'
import CheckoutPage from './pages/CheckoutPage'

import ErrorBoundary from './components/ErrorBoundary'

const VALID_PAGES: PageKey[] = [
  'dashboard', 'data-input', 'products', 'inventory', 'checkout', 'sales', 'forecasts',
  'waste', 'reorders', 'orders', 'suppliers', 'analytics',
  'chat', 'knowledge', 'models', 'admin', 'users', 'settings'
]

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authPage, setAuthPage] = useState<'login' | 'signup'>('login')
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
    sessionStorage.removeItem('inventory_checkout_cart')
    setUser(null)
    setPage('dashboard')
  }

  if (checking) return <div className="boot-screen">Connecting securely to Stockwise AI…</div>
  if (!user) return authPage === 'signup'
    ? <SignupPage onSignup={setUser} onBack={() => setAuthPage('login')}/>
    : <LoginPage onLogin={setUser} onCreateAccount={() => setAuthPage('signup')}/>

  const activePage = user.role === 'admin'
    ? (page === 'admin' ? 'admin' : 'dashboard')
    : (page === 'admin' ? 'dashboard' : page)
  let view: React.ReactNode
  if (activePage === 'dashboard' && user.role === 'admin') view = <AdminDashboardPage onNavigate={setPage}/>
  else if (activePage === 'dashboard') view = <DashboardPage onNavigate={setPage}/>
  else if (activePage === 'admin' && user.role === 'admin') view = <AdminPage currentUser={user}/>
  else if (activePage === 'data-input') view = <DataInputPage/>
  else if (activePage === 'products') view = <ProductsPage/>
  else if (activePage === 'checkout') view = <CheckoutPage/>
  else if (activePage === 'chat') view = <ChatPage/>
  else view = <DataPage kind={activePage} currentUser={user}/>

  return (
    <Layout page={activePage} setPage={setPage} user={user} onLogout={logout}>
      <ErrorBoundary>
        {view}
      </ErrorBoundary>
    </Layout>
  )
}

export default App
