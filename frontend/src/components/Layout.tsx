import { BarChart3, Bot, Boxes, BrainCircuit, ClipboardList, FileText, LineChart, LogOut, Package, ShoppingCart, Truck, Users, Warehouse, FilePlus2, ShieldCheck } from 'lucide-react'
import type { User } from '../types'

export type PageKey = 'dashboard' | 'data-input' | 'products' | 'inventory' | 'checkout' | 'sales' | 'forecasts' | 'waste' | 'reorders' | 'orders' | 'suppliers' | 'analytics' | 'chat' | 'knowledge' | 'models' | 'admin' | 'users' | 'settings'
const links: { key: PageKey; label: string; icon: typeof Boxes; admin?: boolean }[] = [
  { key: 'dashboard', label: 'Overview', icon: BarChart3 }, { key: 'data-input', label: 'Data Input Studio', icon: FilePlus2 }, { key: 'products', label: 'Products', icon: Package }, { key: 'inventory', label: 'Inventory log', icon: Warehouse }, { key: 'checkout', label: 'Checkout', icon: ShoppingCart },
  { key: 'sales', label: 'Sales', icon: LineChart }, { key: 'forecasts', label: 'Forecasts', icon: BrainCircuit }, { key: 'waste', label: 'Waste & expiry', icon: ClipboardList },
  { key: 'reorders', label: 'Order planning', icon: ShoppingCart }, { key: 'orders', label: 'Purchase orders', icon: FileText }, { key: 'suppliers', label: 'Suppliers', icon: Truck },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 }, { key: 'chat', label: 'AI assistant', icon: Bot }, { key: 'knowledge', label: 'Knowledge base', icon: FileText },
  { key: 'models', label: 'Model performance', icon: BrainCircuit }, { key: 'admin', label: 'Administrator', icon: ShieldCheck, admin: true }, { key: 'users', label: 'Users', icon: Users, admin: true }, { key: 'settings', label: 'Settings', icon: Boxes, admin: true },
]

export default function Layout({ page, setPage, user, onLogout, children }: { page: PageKey; setPage: (p: PageKey) => void; user: User; onLogout: () => void; children: React.ReactNode }) {
  const roleLabel = user.role === 'admin' ? 'Super administrator' : user.role === 'business_owner' ? 'Business owner' : user.role
  const visibleLinks = user.role === 'admin'
    ? links.filter(link => link.key === 'dashboard' || link.key === 'admin').map(link => link.key === 'dashboard' ? { ...link, label: 'Global overview' } : link)
    : links.filter(link => link.key === 'users' ? ['business_owner', 'manager'].includes(user.role) : !link.admin)
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">S</span><span>Stockwise <b>AI</b></span></div><nav>{visibleLinks.map(({ key, label, icon: Icon }) => <button key={key} title={label} onClick={() => setPage(key)} className={page === key ? 'nav-link active' : 'nav-link'}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-user"><div className="avatar">{user.full_name[0]}</div><div><strong>{user.full_name}</strong><small>{roleLabel}</small>{user.business_name && <small className="sidebar-business">{user.business_name}</small>}</div><button aria-label="Log out" className="icon-button" onClick={onLogout}><LogOut size={17}/></button></div></aside><main className="content">{children}</main></div>
}
