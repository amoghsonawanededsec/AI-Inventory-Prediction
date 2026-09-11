import { useEffect, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertOctagon, AlertTriangle, Calendar, Clock, Filter, IndianRupee, Layers, PackageCheck, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react'
import { api } from '../lib/api'
import type { Dashboard } from '../types'
import type { PageKey } from '../components/Layout'

type Category = { id: number; name: string }

export default function DashboardPage({ onNavigate }: { onNavigate?: (page: PageKey) => void }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [daysFilter, setDaysFilter] = useState<number>(30)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  async function loadData(days: number, catId: string) {
    setLoading(true)
    setError('')
    try {
      const today = new Date()
      const start = new Date()
      start.setDate(today.getDate() - days)
      const startStr = start.toISOString().slice(0, 10)
      const endStr = today.toISOString().slice(0, 10)

      let url = `/api/dashboard?start=${startStr}&end=${endStr}`
      if (catId !== 'all') {
        url += `&category_id=${catId}`
      }
      const res = await api<Dashboard>(url)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load dashboard signals')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api<Category[]>('/api/categories').then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    loadData(daysFilter, selectedCategory)
  }, [daysFilter, selectedCategory])

  async function handleRefreshInsights() {
    setRefreshing(true)
    try {
      await api('/api/insights/refresh', { method: 'POST' })
      await loadData(daysFilter, selectedCategory)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh operational insights')
    } finally {
      setRefreshing(false)
    }
  }

  const handleAskAI = () => {
    if (onNavigate) {
      onNavigate('chat')
    } else {
      window.location.hash = 'chat'
    }
  }

  if (loading && !data) return <div className="loading">Loading live operational signals…</div>
  if (error && !data) return <div className="error-state">{error}</div>
  if (!data) return null

  const k = data.kpis

  const allCards = [
    { key: 'total_products', label: 'Total Products', value: k.total_products.toLocaleString(), sub: 'Active in catalog', icon: PackageCheck, color: '#0f766e', target: 'products' as PageKey },
    { key: 'low_stock_products', label: 'Low-Stock Items', value: k.low_stock_products.toLocaleString(), sub: 'At or below reorder pt', icon: AlertTriangle, color: '#d97706', target: 'products' as PageKey },
    { key: 'expiring_soon_products', label: 'Expiring Soon', value: k.expiring_soon_products.toLocaleString(), sub: 'Within 7 days', icon: AlertOctagon, color: '#e11d48', target: 'waste' as PageKey },
    { key: 'predicted_waste_value', label: 'Predicted Waste Risk', value: `₹${k.predicted_waste_value.toLocaleString()}`, sub: 'Estimated exposure', icon: Clock, color: '#be123c', target: 'waste' as PageKey },
    { key: 'expected_demand', label: 'Expected Demand', value: `${k.expected_demand.toLocaleString()} units`, sub: '7-day forecast sum', icon: TrendingUp, color: '#0284c7', target: 'forecasts' as PageKey },
    { key: 'recommended_orders', label: 'Recommended Orders', value: k.recommended_orders.toLocaleString(), sub: 'Awaiting approval', icon: ShoppingBag, color: '#4f46e5', target: 'reorders' as PageKey },
    { key: 'revenue', label: 'Total Revenue', value: `₹${k.revenue.toLocaleString()}`, sub: `Past ${daysFilter} days`, icon: IndianRupee, color: '#059669', target: 'sales' as PageKey },
    { key: 'inventory_value', label: 'Inventory Value', value: `₹${k.inventory_value.toLocaleString()}`, sub: 'Current asset valuation', icon: Layers, color: '#0f766e', target: 'inventory' as PageKey },
  ]

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">OPERATIONS OVERVIEW</p>
          <h1>Good morning, inventory team</h1>
          <p>
            Live database calculations. Last updated{' '}
            <strong>{new Date(data.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={handleRefreshInsights}
            disabled={refreshing}
            title="Recalculate waste risk and reorders from live database"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Recalculating…' : 'Refresh Insights'}
          </button>
          <button
            type="button"
            id="dashboard-ask-ai-button"
            onClick={handleAskAI}
            className="primary-button"
          >
            Ask the AI Assistant
          </button>
        </div>
      </header>

      {/* Date Range and Category Filters */}
      <section className="panel" style={{ padding: '0.85rem 1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Calendar size={16} color="#0f766e" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Date Range:</span>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
              {[7, 14, 30, 90].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysFilter(d)}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 4,
                    border: 'none',
                    background: daysFilter === d ? '#0f766e' : 'transparent',
                    color: daysFilter === d ? '#fff' : '#64748b',
                    cursor: 'pointer'
                  }}
                >
                  Last {d}d
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Filter size={16} color="#0f766e" />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Category:</span>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              style={{
                fontSize: 13,
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#334155'
              }}
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* 8 Live KPI Cards */}
      <section className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {allCards.map(({ key, label, value, sub, icon: Icon, color, target }) => (
          <article
            className="kpi-card"
            key={key}
            style={{ cursor: target && onNavigate ? 'pointer' : 'default', borderTop: `3px solid ${color}` }}
            onClick={() => target && onNavigate?.(target)}
            title={target ? `Click to view ${label}` : undefined}
          >
            <div className="kpi-icon" style={{ color }}><Icon size={18} /></div>
            <p>{label}</p>
            <h2 style={{ fontSize: '1.45rem', margin: '0.25rem 0' }}>{value}</h2>
            <small>{sub}</small>
          </article>
        ))}
      </section>

      {/* Charts Section */}
      <section className="chart-grid" style={{ marginTop: '1.25rem' }}>
        <article className="panel wide">
          <div className="panel-heading">
            <div>
              <h2>Sales &amp; Revenue Trends</h2>
              <p>Daily revenue (₹) and units sold over the selected period</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.sales_trend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" tickFormatter={v => String(v).slice(5)} stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip formatter={(val: number) => val.toLocaleString()} />
              <Legend />
              <Line type="monotone" name="Revenue (₹)" dataKey="revenue" stroke="#0f766e" strokeWidth={2.5} dot={false} />
              <Line type="monotone" name="Units Sold" dataKey="units" stroke="#e99b31" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Category Contribution</h2>
              <p>Revenue distribution across departments</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data.category_sales}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                fill="#0f766e"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                fontSize={11}
              />
              <Tooltip formatter={(val: number) => `₹${val.toLocaleString()}`} />
            </PieChart>
          </ResponsiveContainer>
        </article>
      </section>

      {/* Grounded Insight Footer Strip */}
      <section className="insight-strip" style={{ marginTop: '1rem' }}>
        <span>Active Catalog: <strong>{k.total_products} items</strong> across {categories.length} categories</span>
        <span>Reorder Alerts: <strong>{k.low_stock_products} items</strong> below safety threshold</span>
        <span>Expected 7-day Demand: <strong>{k.expected_demand.toLocaleString()} units</strong></span>
        <span>Estimated Waste Risk: <strong>₹{k.predicted_waste_value.toLocaleString()}</strong></span>
      </section>
    </>
  )
}
