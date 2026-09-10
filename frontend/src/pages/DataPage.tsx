import { useEffect, useMemo, useState } from 'react'
import { Check, CheckCheck, ChevronDown, ChevronRight, Download, PackageCheck, RefreshCw, Search, ShoppingCart, Truck, X } from 'lucide-react'
import { api } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

type Item = Record<string, unknown>
const titles: Record<string, { title: string; subtitle: string }> = {
  inventory: { title: 'Inventory activity', subtitle: 'Every stock movement is retained in the audit-ready transaction log.' },
  sales: { title: 'Sales data', subtitle: 'Daily sales feed forecasts, revenue analytics and waste estimation.' },
  forecasts: { title: 'Demand forecasts', subtitle: 'Seasonal baseline forecasts are stored per product and date.' },
  waste: { title: 'Waste & expiry', subtitle: 'Prioritized surplus risk and product-expiry actions.' },
  reorders: { title: 'Order planning & recommendations', subtitle: 'Recommendations need manager approval before becoming purchase orders.' },
  orders: { title: 'Purchase orders', subtitle: 'Track draft, approval, supplier order and goods receipt status.' },
  suppliers: { title: 'Supplier management', subtitle: 'Lead times, reliability and supplied products.' },
  analytics: { title: 'Supplier analytics', subtitle: 'Compare supplier lead-time and service reliability signals.' },
  knowledge: { title: 'Knowledge base', subtitle: 'Policies used for grounded chatbot explanations.' },
  models: { title: 'Model performance', subtitle: 'Chronological train/test evaluation for forecasting models.' },
  users: { title: 'User management', subtitle: 'Roles are enforced by the backend on every protected operation.' },
  settings: { title: 'System settings', subtitle: 'Deployment-controlled configuration and operational safeguards.' },
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
  return String(value)
}

export default function DataPage({ kind }: { kind: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({})

  const config = titles[kind] || { title: kind, subtitle: '' }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const payload = await api<Item[] | { items: Item[] }>(endpoints[kind])
      setItems(Array.isArray(payload) ? payload : payload.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load records')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (kind === 'settings') {
      setLoading(false)
      return
    }
    load()
  }, [kind])

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
      setSuccess(status === 'received' ? `Purchase Order #${poId} received and stock credited!` : `PO #${poId} updated to ${status}.`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed')
    }
  }

  const filtered = useMemo(() => items.filter(item =>
    JSON.stringify(item).toLowerCase().includes(search.toLowerCase())
  ), [items, search])

  if (kind === 'settings') {
    return (
      <>
        <header className="page-header">
          <div>
            <p className="eyebrow">CONFIGURATION</p>
            <h1>{config.title}</h1>
            <p>{config.subtitle}</p>
          </div>
        </header>
        <section className="settings-grid">
          <article className="panel">
            <h2>Security</h2>
            <p>JWT expiration, password hashing, backend role checks, rate-limited chat, and safe CORS are configured through environment variables.</p>
          </article>
          <article className="panel">
            <h2>Forecasting</h2>
            <p>Run the chronological evaluation script to persist model metrics, then compare results on the Model performance page.</p>
          </article>
          <article className="panel">
            <h2>Deployment</h2>
            <p>Use Docker Compose for PostgreSQL, FastAPI and the production web bundle. See the repository README for exact commands.</p>
          </article>
        </section>
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
          {kind === 'reorders' && (
            <button className="primary-button" onClick={handleConvertApprovedReorders}>
              <ShoppingCart size={16} />
              Convert to Purchase Order
            </button>
          )}
          {kind === 'sales' && (
            <a className="secondary-button" href="/api/sales/export">
              <Download size={16} />
              Export CSV
            </a>
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
                    .filter(key => !['id', 'created_at', 'updated_at', 'batches', 'items'].includes(key))
                    .slice(0, 8)
                    .map(key => (
                      <th key={key}>{key.replace(/_/g, ' ')}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => {
                  const cols = Object.keys(item).filter(k => !['id', 'created_at', 'updated_at', 'batches', 'items'].includes(k)).slice(0, 8)
                  return (
                    <tr key={String(item.id ?? index)}>
                      {cols.map(key => (
                        <td key={key}>
                          {key === 'risk_level' || key === 'status' || key === 'severity' ? (
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
    </>
  )
}
