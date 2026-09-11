import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  BrainCircuit,
  Calculator,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  TrendingUp,
  Truck,
  Upload,
  UserPlus,
  X
} from 'lucide-react'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

type Item = Record<string, unknown>
type SystemInfo = {
  app_name: string
  environment: string
  database_engine: string
  llm_configured: boolean
  llm_model: string
  llm_base_url: string
  rate_limiting: string
  auth_security: string
  version: string
}

type WhatIfResult = {
  product: string
  scenario: Record<string, unknown>
  forecast_demand_during_lead_time: number
  stockout_risk: string
  waste_risk: string
  recommended_order: number
  projected_price: number
}

const titles: Record<string, { title: string; subtitle: string }> = {
  inventory: { title: 'Inventory Activity & Batches', subtitle: 'Every stock movement and batch receipt is retained in the audit log.' },
  sales: { title: 'Sales Records & Analytics', subtitle: 'Daily actuals feed demand forecasts, revenue tracking and waste estimation.' },
  forecasts: { title: 'Demand Forecasts', subtitle: 'Multi-horizon forecasts (7, 14, 30 days) stored per product and date.' },
  waste: { title: 'Waste Risk & Expiry Prevention', subtitle: 'Prioritized surplus exposure and recommended mitigation actions.' },
  reorders: { title: 'Smart Order Recommendations', subtitle: 'Calculated using forecast demand, safety stock, and supplier lead time.' },
  orders: { title: 'Purchase Orders', subtitle: 'Full procurement workflow: Draft → Approved → Ordered → Received.' },
  suppliers: { title: 'Supplier Directory', subtitle: 'Configured lead times, minimum order quantities and reliability scores.' },
  analytics: { title: 'Analytics & What-If Simulation', subtitle: 'Supplier performance benchmarks and dynamic scenario stress testing.' },
  knowledge: { title: 'RAG Knowledge Base', subtitle: 'Standard operating procedures and policies cited by the conversational chatbot.' },
  models: { title: 'ML Model Performance & Evaluation', subtitle: 'Chronological holdout evaluation comparing Baseline, Random Forest and XGBoost.' },
  users: { title: 'User & Role Management', subtitle: 'Role-based access control (Admin, Manager, Staff) enforced by backend.' },
  settings: { title: 'System Architecture & Configuration', subtitle: 'Operational settings, model parameters, and database connectivity.' },
}

const endpoints: Record<string, string> = {
  inventory: '/api/inventory/transactions',
  sales: '/api/sales?page_size=50',
  forecasts: '/api/forecasts?horizon_days=14',
  waste: '/api/waste',
  reorders: '/api/reorders',
  orders: '/api/purchase-orders',
  suppliers: '/api/suppliers',
  analytics: '/api/analytics/suppliers',
  knowledge: '/api/knowledge',
  models: '/api/models/runs',
  users: '/api/users'
}

function format(value: unknown, key: string) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (key.includes('date') || key.endsWith('_at')) {
    const d = new Date(String(value))
    return Number.isNaN(d.valueOf()) ? String(value) : d.toLocaleDateString()
  }
  if (typeof value === 'number' && (key.includes('revenue') || key.includes('value') || key.includes('price'))) {
    return `₹${value.toLocaleString()}`
  }
  if (typeof value === 'number' && (key === 'mae' || key === 'rmse')) {
    return value.toFixed(3)
  }
  if (typeof value === 'number' && key === 'r2') {
    return `${(value * 100).toFixed(1)}%`
  }
  if (typeof value === 'number' && key === 'mape') {
    return `${value.toFixed(1)}%`
  }
  return String(value)
}

export default function DataPage({ kind }: { kind: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({})

  // Specialized states
  const [forecastHorizon, setForecastHorizon] = useState<number>(14)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [productsList, setProductsList] = useState<Array<{ id: number; name: string; price: number; lead_time_days: number }>>([])

  // Modals
  const [showImportModal, setShowImportModal] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [showDocModal, setShowDocModal] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  // What-If Simulation State
  const [whatIfProduct, setWhatIfProduct] = useState<number>(1)
  const [whatIfDemand, setWhatIfDemand] = useState<number>(20)
  const [whatIfPrice, setWhatIfPrice] = useState<number>(0)
  const [whatIfPromo, setWhatIfPromo] = useState<boolean>(false)
  const [whatIfLead, setWhatIfLead] = useState<number | ''>('')
  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null)
  const [simulating, setSimulating] = useState(false)

  const config = titles[kind] || { title: kind, subtitle: '' }

  async function load() {
    setLoading(true)
    setError('')
    try {
      if (kind === 'settings') {
        const info = await api<SystemInfo>('/api/system/info')
        setSystemInfo(info)
        setLoading(false)
        return
      }

      let ep = endpoints[kind]
      if (kind === 'forecasts') {
        ep = `/api/forecasts?horizon_days=${forecastHorizon}`
      }
      const payload = await api<Item[] | { items: Item[] }>(ep)
      setItems(Array.isArray(payload) ? payload : payload.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load records')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    if (kind === 'analytics' || kind === 'forecasts') {
      api<{ items: Array<{ id: number; name: string; price: number; lead_time_days: number }> }>('/api/products?page_size=100')
        .then(r => {
          setProductsList(r.items)
          if (r.items.length && !whatIfProduct) setWhatIfProduct(r.items[0].id)
        })
        .catch(() => {})
    }
  }, [kind, forecastHorizon])

  // Reorders actions
  async function handleReorderAction(recId: number, status: 'approved' | 'rejected') {
    try {
      await api(`/api/reorders/${recId}/action`, {
        method: 'POST',
        body: JSON.stringify({ status })
      })
      setSuccess(`Recommendation #${recId} marked as ${status}.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    }
  }

  async function handleConvertApprovedReorders() {
    const approved = items.filter(r => r.status === 'approved' || r.status === 'draft')
    if (!approved.length) {
      setError('No recommendations available to convert.')
      return
    }
    try {
      const res = await api<{ created_pos: number[]; message: string }>('/api/purchase-orders/from-reorders', {
        method: 'POST',
        body: JSON.stringify({ recommendation_ids: approved.map(r => Number(r.id)) })
      })
      setSuccess(`${res.message}. View them on the Purchase Orders page.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not convert recommendations')
    }
  }

  // Purchase Order status actions
  async function handlePOStatus(poId: number, status: string) {
    try {
      await api(`/api/purchase-orders/${poId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      })
      setSuccess(status === 'received' ? `Purchase Order #${poId} received and inventory stock credited!` : `PO #${poId} updated to ${status}.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed')
    }
  }

  // Model training trigger
  async function handleTrainModels() {
    setActionLoading(true)
    setError('')
    try {
      const res = await api<{ message: string; results: Array<{ model: string; mae: number; r2: number }> }>('/api/models/train', { method: 'POST' })
      setSuccess(`${res.message}! Evaluated ${res.results.length} models.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model training failed')
    } finally {
      setActionLoading(false)
    }
  }

  // Forecasts generation
  async function handleGenerateForecasts() {
    setActionLoading(true)
    setError('')
    try {
      const res = await api<{ generated: number; horizon_days: number }>('/api/forecasts/generate', {
        method: 'POST',
        body: JSON.stringify({ horizon_days: forecastHorizon })
      })
      setSuccess(`Generated ${res.generated} forecast records across catalog for ${res.horizon_days} days.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Forecast generation failed')
    } finally {
      setActionLoading(false)
    }
  }

  // CSV Import
  async function handleCSVUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement
    if (!fileInput || !fileInput.files?.length) {
      setError('Please choose a CSV file.')
      return
    }
    const formData = new FormData()
    formData.append('file', fileInput.files[0])
    setActionLoading(true)
    setError('')
    try {
      const res = await api<{ inserted: number; errors: unknown[] }>('/api/sales/import', {
        method: 'POST',
        body: formData
      })
      setSuccess(`CSV imported successfully: ${res.inserted} sales rows inserted.`)
      setShowImportModal(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV')
    } finally {
      setActionLoading(false)
    }
  }

  // Add User
  async function handleCreateUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const body = {
      email: String(form.get('email')),
      full_name: String(form.get('full_name')),
      password: String(form.get('password')),
      role: String(form.get('role'))
    }
    setActionLoading(true)
    setError('')
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(body) })
      setSuccess(`User ${body.email} created with role ${body.role}.`)
      setShowUserModal(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setActionLoading(false)
    }
  }

  // Add Knowledge Document
  async function handleCreateDoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const title = String(form.get('title'))
    const bodyText = String(form.get('body'))
    setActionLoading(true)
    setError('')
    try {
      await api(`/api/knowledge?title=${encodeURIComponent(title)}&body=${encodeURIComponent(bodyText)}`, { method: 'POST' })
      setSuccess(`Document "${title}" saved and indexed for RAG chatbot retrieval.`)
      setShowDocModal(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save document')
    } finally {
      setActionLoading(false)
    }
  }

  // Run What-If Simulation
  async function runWhatIfSimulation() {
    setSimulating(true)
    try {
      const payload: Record<string, unknown> = {
        product_id: whatIfProduct,
        demand_change_pct: whatIfDemand,
        price_change_pct: whatIfPrice,
        promotion: whatIfPromo,
      }
      if (whatIfLead !== '') {
        payload.lead_time_days = Number(whatIfLead)
      }
      const res = await api<WhatIfResult>('/api/what-if', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      setWhatIfResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setSimulating(false)
    }
  }

  const filtered = useMemo(() => items.filter(item =>
    JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
  ), [items, search])

  // SETTINGS VIEW
  if (kind === 'settings') {
    return (
      <>
        <header className="page-header">
          <div>
            <p className="eyebrow">CONFIGURATION &amp; ARCHITECTURE</p>
            <h1>{config.title}</h1>
            <p>{config.subtitle}</p>
          </div>
          <button className="secondary-button" onClick={load}>
            <RefreshCw size={15} /> Refresh
          </button>
        </header>

        {systemInfo && (
          <section className="settings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            <article className="panel" style={{ borderLeft: '4px solid #0f766e' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
                <BrainCircuit size={20} color="#0f766e" />
                <h2 style={{ margin: 0 }}>AI Reasoning &amp; Chatbot Engine</h2>
              </div>
              <p style={{ marginBottom: '0.75rem', fontSize: 13, color: '#475569' }}>
                Dual-layer design: Grounded deterministic database query tools combined with LLM conversational formatting and policy RAG citations.
              </p>
              <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><strong>LLM Configured:</strong> {systemInfo.llm_configured ? <span style={{ color: '#059669', fontWeight: 600 }}>Active (Environment Variable)</span> : <span style={{ color: '#d97706', fontWeight: 600 }}>Tool-Only Mode (Deterministic)</span>}</div>
                <div><strong>Active Model:</strong> <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4 }}>{systemInfo.llm_model}</code></div>
                <div><strong>API Endpoint:</strong> <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: 4 }}>{systemInfo.llm_base_url}</code></div>
                <div><strong>Grounded SQL Tools:</strong> <span style={{ color: '#0f766e', fontWeight: 600 }}>Active (Zero Hallucination)</span></div>
                <div><strong>RAG Citation Engine:</strong> <span style={{ color: '#0f766e', fontWeight: 600 }}>Active (Internal Vector Chunks)</span></div>
              </div>
            </article>

            <article className="panel" style={{ borderLeft: '4px solid #0284c7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
                <Server size={20} color="#0284c7" />
                <h2 style={{ margin: 0 }}>Data &amp; Infrastructure</h2>
              </div>
              <p style={{ marginBottom: '0.75rem', fontSize: 13, color: '#475569' }}>
                Relational persistence, model runs tracking, and transactional integrity.
              </p>
              <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><strong>Database Engine:</strong> {systemInfo.database_engine}</div>
                <div><strong>App Environment:</strong> {systemInfo.environment}</div>
                <div><strong>Rate Limiting:</strong> {systemInfo.rate_limiting}</div>
                <div><strong>System Version:</strong> {systemInfo.version}</div>
              </div>
            </article>

            <article className="panel" style={{ borderLeft: '4px solid #4f46e5' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
                <ShieldCheck size={20} color="#4f46e5" />
                <h2 style={{ margin: 0 }}>Security &amp; RBAC</h2>
              </div>
              <p style={{ marginBottom: '0.75rem', fontSize: 13, color: '#475569' }}>
                Every protected operation is authenticated using JWT tokens and validated by backend role guards.
              </p>
              <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: 8, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><strong>Authentication:</strong> {systemInfo.auth_security}</div>
                <div><strong>Secret Storage:</strong> Server-side .env (Never leaked to frontend)</div>
                <div><strong>Roles:</strong> Admin (Full control), Manager (Approvals/PO), Staff (Operational entry)</div>
              </div>
            </article>
          </section>
        )}
      </>
    )
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">OPERATIONAL DATA</p>
          <h1>{config.title}</h1>
          <p>{config.subtitle}</p>
        </div>
        <div className="header-actions">
          {kind === 'forecasts' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
                {[7, 14, 30].map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setForecastHorizon(h)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 4,
                      border: 'none',
                      background: forecastHorizon === h ? '#0f766e' : 'transparent',
                      color: forecastHorizon === h ? '#fff' : '#64748b',
                      cursor: 'pointer'
                    }}
                  >
                    {h} Days
                  </button>
                ))}
              </div>
              <button className="primary-button" onClick={handleGenerateForecasts} disabled={actionLoading}>
                <TrendingUp size={15} /> Generate Forecasts
              </button>
            </div>
          )}

          {kind === 'models' && (
            <button className="primary-button" onClick={handleTrainModels} disabled={actionLoading}>
              <Play size={15} /> {actionLoading ? 'Training Models…' : 'Train & Evaluate Models'}
            </button>
          )}

          {kind === 'reorders' && (
            <button className="primary-button" onClick={handleConvertApprovedReorders}>
              <ShoppingCart size={16} />
              Convert to Purchase Order
            </button>
          )}

          {kind === 'sales' && (
            <>
              <button className="secondary-button" onClick={() => setShowImportModal(true)}>
                <Upload size={16} /> Import CSV
              </button>
              <a className="secondary-button" href="/api/sales/export">
                <Download size={16} /> Export CSV
              </a>
            </>
          )}

          {kind === 'users' && (
            <button className="primary-button" onClick={() => setShowUserModal(true)}>
              <UserPlus size={16} /> Add User
            </button>
          )}

          {kind === 'knowledge' && (
            <button className="primary-button" onClick={() => setShowDocModal(true)}>
              <FilePlus size={16} /> Add Policy Document
            </button>
          )}

          <button className="secondary-button" onClick={load}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </header>

      {success && (
        <div className="insight-strip" style={{ marginBottom: 16 }}>
          <span>{success}</span>
          <button className="icon-button" onClick={() => setSuccess('')}><X size={14} /></button>
        </div>
      )}

      {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}

      {/* WHAT-IF SIMULATOR ON ANALYTICS TAB */}
      {kind === 'analytics' && (
        <section className="panel" style={{ marginBottom: '1.5rem', borderLeft: '4px solid #4f46e5' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
            <Calculator size={20} color="#4f46e5" />
            <h2 style={{ margin: 0 }}>Interactive What-If Scenario Simulator</h2>
          </div>
          <p style={{ fontSize: 13, color: '#475569', marginBottom: '1rem' }}>
            Simulate the operational impact of demand shifts, promotional events, price adjustments, and supplier lead-time changes on inventory stockout risk, waste risk, and recommended purchase order size.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'flex-end', background: '#f8fafc', padding: '1rem', borderRadius: 8 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Select Product:</label>
              <select
                value={whatIfProduct}
                onChange={e => setWhatIfProduct(Number(e.target.value))}
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13 }}
              >
                {productsList.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (₹{p.price})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Demand Change: <strong>{whatIfDemand > 0 ? `+${whatIfDemand}%` : `${whatIfDemand}%`}</strong>
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[-20, -10, 10, 20, 30].map(pct => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setWhatIfDemand(pct)}
                    style={{
                      padding: '4px 8px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 4,
                      border: 'none',
                      background: whatIfDemand === pct ? '#4f46e5' : '#e2e8f0',
                      color: whatIfDemand === pct ? '#fff' : '#334155',
                      cursor: 'pointer'
                    }}
                  >
                    {pct > 0 ? `+${pct}%` : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Price Change (%):</label>
              <input
                type="number"
                value={whatIfPrice}
                onChange={e => setWhatIfPrice(Number(e.target.value))}
                placeholder="0"
                style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Promotion:</label>
              <button
                type="button"
                onClick={() => setWhatIfPromo(!whatIfPromo)}
                style={{
                  width: '100%',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: whatIfPromo ? '#0f766e' : '#fff',
                  color: whatIfPromo ? '#fff' : '#334155',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {whatIfPromo ? 'Promotion ACTIVE (+15%)' : 'No Promotion'}
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={runWhatIfSimulation}
                disabled={simulating}
                className="primary-button"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Sliders size={15} /> {simulating ? 'Simulating…' : 'Run Simulation'}
              </button>
            </div>
          </div>

          {whatIfResult && (
            <div style={{ marginTop: '1rem', padding: '1rem', background: '#eef2ff', borderRadius: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: 12, color: '#4b5563', display: 'block' }}>Product Simulated</span>
                <strong style={{ fontSize: 15, color: '#1e1b4b' }}>{whatIfResult.product}</strong>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#4b5563', display: 'block' }}>Lead-Time Demand</span>
                <strong style={{ fontSize: 15, color: '#1e1b4b' }}>{whatIfResult.forecast_demand_during_lead_time} units</strong>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#4b5563', display: 'block' }}>Stockout Risk</span>
                <StatusBadge value={whatIfResult.stockout_risk} />
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#4b5563', display: 'block' }}>Waste Risk</span>
                <StatusBadge value={whatIfResult.waste_risk} />
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#4b5563', display: 'block' }}>Recommended Order</span>
                <strong style={{ fontSize: 16, color: '#0f766e' }}>{whatIfResult.recommended_order} units</strong>
              </div>
              <div>
                <span style={{ fontSize: 12, color: '#4b5563', display: 'block' }}>Projected Price</span>
                <strong style={{ fontSize: 15, color: '#1e1b4b' }}>₹{whatIfResult.projected_price}</strong>
              </div>
            </div>
          )}
        </section>
      )}

      {/* MODEL PERFORMANCE COMPARISON CARDS */}
      {kind === 'models' && items.length > 0 && (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
          {['xgboost', 'random_forest', 'seasonal_baseline'].map(mName => {
            const best = items.find(it => String(it.model_name).toLowerCase() === mName)
            if (!best) return null
            return (
              <div key={mName} className="panel" style={{ borderTop: mName === 'xgboost' ? '3px solid #0f766e' : '3px solid #64748b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ textTransform: 'capitalize', fontSize: 14 }}>{mName.replace('_', ' ')}</strong>
                  {mName === 'xgboost' && <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>Top Accuracy</span>}
                </div>
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4, color: '#475569' }}>
                  <div>MAE: <strong>{Number(best.mae).toFixed(3)}</strong> (Mean Abs Error)</div>
                  <div>RMSE: <strong>{Number(best.rmse).toFixed(3)}</strong></div>
                  <div>MAPE: <strong>{Number(best.mape).toFixed(1)}%</strong></div>
                  <div>R² Score: <strong style={{ color: '#0f766e' }}>{(Number(best.r2) * 100).toFixed(1)}%</strong></div>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* MAIN DATA TABLE */}
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Search records"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search records…"
            />
          </div>
          <span>{filtered.length} records</span>
        </div>

        {loading ? (
          <div className="loading">Loading records…</div>
        ) : !filtered.length ? (
          <div className="empty-state">No records match the current view.</div>
        ) : kind === 'reorders' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Current Stock</th>
                  <th>Reorder Point</th>
                  <th>Forecast Demand</th>
                  <th>Recommended Qty</th>
                  <th>Formula Explanation</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={String(r.id)}>
                    <td><strong>{String(r.product_name)}</strong></td>
                    <td>{Number(r.current_stock)}</td>
                    <td>{Number(r.reorder_point)}</td>
                    <td>{Number(r.forecast_demand)}</td>
                    <td><strong style={{ color: '#0f766e', fontSize: 14 }}>{Number(r.recommended_quantity)}</strong></td>
                    <td style={{ maxWidth: 320, whiteSpace: 'normal', fontSize: 12, color: '#556961' }}>{String(r.explanation)}</td>
                    <td><StatusBadge value={String(r.status)} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {r.status === 'draft' ? (
                          <>
                            <button
                              className="btn-sm btn-approve"
                              onClick={() => handleReorderAction(Number(r.id), 'approved')}
                              title="Approve recommendation"
                            >
                              <Check size={14} /> Approve
                            </button>
                            <button
                              className="btn-sm btn-reject"
                              onClick={() => handleReorderAction(Number(r.id), 'rejected')}
                              title="Reject recommendation"
                            >
                              <X size={14} /> Reject
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: '#889a92' }}>Actioned</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : kind === 'orders' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Expected Delivery</th>
                  <th>Items</th>
                  <th>Created</th>
                  <th>Order Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(po => {
                  const poId = Number(po.id)
                  const itemsList = (po.items as Array<{ product_id: number; product_name: string; quantity: number; unit_price: number }>) || []
                  const isExpanded = Boolean(expandedOrders[poId])
                  const currentStatus = String(po.status)
                  return (
                    <tr key={poId} style={{ verticalAlign: 'top' }}>
                      <td>
                        <button
                          className="btn-sm"
                          style={{ background: 'transparent', padding: 0 }}
                          onClick={() => setExpandedOrders(prev => ({ ...prev, [poId]: !prev[poId] }))}
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          <strong>PO #{poId}</strong>
                        </button>
                      </td>
                      <td><strong>{String(po.supplier_name)}</strong></td>
                      <td><StatusBadge value={currentStatus} /></td>
                      <td>{format(po.expected_delivery, 'expected_delivery')}</td>
                      <td>
                        <span>{itemsList.length} line item(s)</span>
                        {isExpanded && (
                          <div style={{ marginTop: 6, padding: '6px 10px', background: '#f6f9f7', borderRadius: 6, fontSize: 12 }}>
                            {itemsList.map((it, idx) => (
                              <div key={idx} style={{ margin: '2px 0' }}>
                                • {it.product_name}: <strong>{it.quantity} units</strong> @ ₹{it.unit_price}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{format(po.created_at, 'created_at')}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {currentStatus === 'draft' && (
                            <button
                              className="btn-sm btn-approve"
                              onClick={() => handlePOStatus(poId, 'approved')}
                            >
                              <CheckCheck size={14} /> Approve PO
                            </button>
                          )}
                          {currentStatus === 'approved' && (
                            <button
                              className="btn-sm btn-action"
                              onClick={() => handlePOStatus(poId, 'ordered')}
                            >
                              <Truck size={14} /> Mark Ordered
                            </button>
                          )}
                          {currentStatus === 'ordered' && (
                            <button
                              className="btn-sm btn-approve"
                              onClick={() => handlePOStatus(poId, 'received')}
                            >
                              <PackageCheck size={14} /> Receive Goods
                            </button>
                          )}
                          {currentStatus === 'received' && (
                            <span style={{ fontSize: 12, color: '#147252', fontWeight: 600 }}>Fulfilled</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {Object.keys(filtered[0] || {})
                    .filter(key => !['id', 'created_at', 'updated_at', 'batches', 'items', 'payload', 'password_hash'].includes(key))
                    .slice(0, 8)
                    .map(key => (
                      <th key={key}>{key.replace(/_/g, ' ')}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => {
                  const cols = Object.keys(item).filter(k => !['id', 'created_at', 'updated_at', 'batches', 'items', 'payload', 'password_hash'].includes(k)).slice(0, 8)
                  return (
                    <tr key={String(item.id ?? index)}>
                      {cols.map(key => (
                        <td key={key}>
                          {key === 'risk_level' || key === 'status' || key === 'severity' || key === 'role' ? (
                            <StatusBadge value={String(item[key])} />
                          ) : (
                            format(item[key], key)
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Import Sales CSV</h2>
              <button className="icon-button" onClick={() => setShowImportModal(false)}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: '1rem' }}>
              Upload a CSV with columns: <code>date, product_id, quantity_sold, unit_price, discount, promotion, holiday, channel, location</code>
            </p>
            <form onSubmit={handleCSVUpload}>
              <input type="file" accept=".csv" required style={{ width: '100%', marginBottom: '1rem' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="secondary-button" onClick={() => setShowImportModal(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={actionLoading}>
                  {actionLoading ? 'Uploading…' : 'Upload & Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showUserModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Create New Application User</h2>
              <button className="icon-button" onClick={() => setShowUserModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Full Name</label>
                <input name="full_name" required placeholder="Jane Doe" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Email</label>
                <input name="email" type="email" required placeholder="user@inventory.example.com" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Password</label>
                <input name="password" type="password" required minLength={8} placeholder="••••••••" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Role</label>
                <select name="role" required style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                  <option value="staff">Staff (Operational &amp; Chatbot)</option>
                  <option value="manager">Inventory Manager (Approvals &amp; Orders)</option>
                  <option value="admin">Admin (Full Control &amp; System Configuration)</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '0.5rem' }}>
                <button type="button" className="secondary-button" onClick={() => setShowUserModal(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={actionLoading}>Create User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Policy Document Modal */}
      {showDocModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2>Add Policy / Knowledge Document</h2>
              <button className="icon-button" onClick={() => setShowDocModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateDoc} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Document Title</label>
                <input name="title" required placeholder="e.g. Returned Goods Inspection Standard" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Policy Body</label>
                <textarea name="body" required rows={5} placeholder="Full policy description to be chunked and indexed for grounded chatbot answers..." style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '0.5rem' }}>
                <button type="button" className="secondary-button" onClick={() => setShowDocModal(false)}>Cancel</button>
                <button type="submit" className="primary-button" disabled={actionLoading}>Save &amp; Index Document</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
