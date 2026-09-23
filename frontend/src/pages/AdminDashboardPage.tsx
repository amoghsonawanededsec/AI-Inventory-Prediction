import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Building2, Database, IndianRupee, PackageCheck, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import type { PageKey } from '../components/Layout'

type AdminDashboardData = {
  last_updated: string
  businesses: { id: number; name: string; is_active: boolean }[]
  categories: string[]
  business_performance: { id: number; name: string; owner_email: string; is_active: boolean; accounts: number; products: number; low_stock: number; transactions: number; revenue: number }[]
  kpis: { businesses: number; accounts: number; products: number; low_stock: number; revenue: number; recommended_orders: number; expected_demand: number; predicted_waste_value: number; inventory_value: number }
  sales_trend: { date: string; revenue: number; units: number }[]
  category_sales: { name: string; value: number }[]
}

const chartColors = ['#16816b', '#e49a3a', '#4f8291', '#8a6b55', '#65a276', '#c66550', '#7287bd', '#b586bd']
function localDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

export default function AdminDashboardPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const [days, setDays] = useState(30)
  const [businessId, setBusinessId] = useState('all')
  const [category, setCategory] = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)
  const [data, setData] = useState<AdminDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - days)
    const params = new URLSearchParams({ start: localDate(start), end: localDate(end) })
    if (businessId !== 'all') params.set('business_id', businessId)
    if (category !== 'all') params.set('category', category)
    setLoading(true)
    setError('')
    api<AdminDashboardData>(`/api/admin/dashboard?${params}`)
      .then(result => { if (alive) setData(result) })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Unable to load global business signals.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [days, businessId, category, refreshKey])

  const selectedBusiness = data?.businesses.find(row => String(row.id) === businessId)
  const stats = data?.kpis
  const cards = stats ? [
    { label: 'Active businesses', value: stats.businesses.toLocaleString(), sub: 'Platform-wide workspaces', icon: Building2, tone: 'green' },
    { label: 'Active products', value: stats.products.toLocaleString(), sub: 'Across selected scope', icon: PackageCheck, tone: 'mint' },
    { label: 'Low-stock items', value: stats.low_stock.toLocaleString(), sub: 'At or below reorder point', icon: AlertTriangle, tone: 'orange' },
    { label: `Revenue · ${days} days`, value: `₹${stats.revenue.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`, sub: 'Recorded sales across workspaces', icon: IndianRupee, tone: 'blue' },
  ] : []

  return <div className="global-dashboard">
    <header className="page-header global-dashboard-header">
      <div>
        <p className="eyebrow">CENTRAL OPERATIONS · SUPER ADMINISTRATOR</p>
        <h1>Cross-business overview</h1>
        <p>{selectedBusiness ? `${selectedBusiness.name} workspace` : 'Live signals across every business workspace'}{data ? ` · Updated ${new Date(data.last_updated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}</p>
      </div>
      <div className="header-actions">
        <button className="secondary-button" onClick={() => setRefreshKey(value => value + 1)} disabled={loading} title="Refresh global business signals"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>Refresh</button>
        <button className="primary-button" onClick={() => onNavigate('admin')}><ShieldCheck size={15}/>Administrator controls</button>
      </div>
    </header>

    <section className="global-filters" aria-label="Global dashboard filters">
      <div className="filter-group"><span className="filter-label">Date range</span><div className="range-options" role="group" aria-label="Date range">{[7, 14, 30, 90].map(value => <button key={value} className={days === value ? 'selected' : ''} onClick={() => setDays(value)}>Last {value}d</button>)}</div></div>
      <label className="global-filter-select"><span>Business</span><select value={businessId} onChange={event => setBusinessId(event.target.value)}><option value="all">All businesses</option>{data?.businesses.map(row => <option key={row.id} value={row.id}>{row.name}{row.is_active ? '' : ' · Suspended'}</option>)}</select></label>
      <label className="global-filter-select"><span>Category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{data?.categories.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    </section>

    {error && <div className="error-state" role="alert">{error}</div>}
    {loading && !data && <div className="loading">Loading cross-business signals…</div>}
    {data && <>
      <section className="kpi-grid global-kpis">
        {cards.map(({ label, value, sub, icon: Icon, tone }) => <article className="kpi-card global-kpi" key={label}>
          <span className={`global-kpi-icon ${tone}`}><Icon size={17}/></span><p>{label}</p><h2>{value}</h2><small>{sub}</small>
        </article>)}
      </section>

      <section className="chart-grid global-charts">
        <article className="panel global-trend-panel">
          <div className="panel-heading"><div><h2>Sales &amp; revenue trends</h2><p>{selectedBusiness ? `Daily sales activity for ${selectedBusiness.name}` : 'Combined daily sales activity across all businesses'}</p></div><span className="global-panel-icon"><Activity size={16}/></span></div>
          {data.sales_trend.length ? <ResponsiveContainer width="100%" height={300}><LineChart data={data.sales_trend} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8efeb"/><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} stroke="#8a9991" fontSize={11} minTickGap={22}/><YAxis yAxisId="revenue" stroke="#8a9991" fontSize={11} tickFormatter={value => `₹${Number(value).toLocaleString('en-IN')}`} width={62}/><YAxis yAxisId="units" orientation="right" stroke="#b28249" fontSize={11} width={42}/><Tooltip formatter={(value: number, name: string) => name === 'Revenue' ? [`₹${value.toLocaleString('en-IN')}`, name] : [value.toLocaleString(), name]}/><Legend/><Line yAxisId="revenue" type="monotone" name="Revenue" dataKey="revenue" stroke="#16816b" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/><Line yAxisId="units" type="monotone" name="Units sold" dataKey="units" stroke="#e49a3a" strokeWidth={2} dot={false} activeDot={{ r: 3 }}/>
          </LineChart></ResponsiveContainer> : <div className="global-chart-empty"><Activity size={22}/><span>No sales recorded in this date range.</span></div>}
        </article>
        <article className="panel global-category-panel">
          <div className="panel-heading"><div><h2>Category contribution</h2><p>Revenue distribution for the selected scope</p></div><span className="global-panel-icon"><Database size={16}/></span></div>
          {data.category_sales.length ? <ResponsiveContainer width="100%" height={300}><PieChart><Pie data={data.category_sales} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={2} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>{data.category_sales.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]}/>)}</Pie><Tooltip formatter={(value: number) => `₹${value.toLocaleString('en-IN')}`}/></PieChart></ResponsiveContainer> : <div className="global-chart-empty"><Database size={22}/><span>No category revenue in this date range.</span></div>}
        </article>
      </section>

      <section className="panel business-performance-panel">
        <div className="panel-heading"><div><h2>Business performance</h2><p>Compare every workspace for the selected period. Select a row to inspect its trend.</p></div><span className="business-row-count"><Users size={14}/>{data.business_performance.length} workspaces</span></div>
        <div className="table-wrap"><table className="admin-table global-business-table"><thead><tr><th>Business / owner</th><th>Accounts</th><th>Products</th><th>Low stock</th><th>Transactions</th><th>Revenue</th><th>Status</th></tr></thead><tbody>
          {data.business_performance.map(row => <tr key={row.id} className={businessId === String(row.id) ? 'selected-business-row' : ''} tabIndex={0} role="button" onClick={() => setBusinessId(businessId === String(row.id) ? 'all' : String(row.id))} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setBusinessId(businessId === String(row.id) ? 'all' : String(row.id)) } }} title={`Show ${row.name} trend`}><td><strong>{row.name}</strong><small>{row.owner_email}</small></td><td>{row.accounts.toLocaleString()}</td><td>{row.products.toLocaleString()}</td><td className={row.low_stock ? 'low-stock-value' : ''}>{row.low_stock.toLocaleString()}</td><td>{row.transactions.toLocaleString()}</td><td><strong>₹{row.revenue.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</strong></td><td><span className={`business-state ${row.is_active ? 'active' : 'disabled'}`}>{row.is_active ? 'Active' : 'Suspended'}</span></td></tr>)}
          {!data.business_performance.length && <tr><td colSpan={7} className="empty-row">No business workspaces have been created.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="insight-strip global-insight-strip"><span>Expected 7-day demand <strong>{stats?.expected_demand.toLocaleString()} units</strong></span><span>Predicted waste exposure <strong>₹{stats?.predicted_waste_value.toLocaleString('en-IN')}</strong></span><span>Inventory value <strong>₹{stats?.inventory_value.toLocaleString('en-IN')}</strong></span><span>Recommended orders <strong>{stats?.recommended_orders.toLocaleString()}</strong></span><span>Active accounts <strong>{stats?.accounts.toLocaleString()}</strong></span></section>
    </>}
  </div>
}
