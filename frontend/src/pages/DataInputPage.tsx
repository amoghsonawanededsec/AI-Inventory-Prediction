import { FormEvent, useEffect, useMemo, useState } from 'react'
import { FileUp, PackagePlus, Search, ShoppingCart, SlidersHorizontal, Trash2, Plus, ArrowDownToLine } from 'lucide-react'
import { api } from '../lib/api'
import type { Product } from '../types'

type Category = { id: number; name: string }
type Supplier = { id: number; name: string }
type Tab = 'product' | 'sale' | 'adjust' | 'bulk'
const tabs: { key: Tab; label: string; icon: typeof PackagePlus }[] = [
  { key: 'product', label: 'Add product', icon: PackagePlus }, { key: 'sale', label: 'Record sale', icon: ShoppingCart },
  { key: 'adjust', label: 'Stock adjustment', icon: SlidersHorizontal }, { key: 'bulk', label: 'Bulk import', icon: FileUp },
]

export default function DataInputPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [tab, setTab] = useState<Tab>('product')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [paste, setPaste] = useState('')

  async function load() {
    const [p, c, s] = await Promise.all([
      api<{ items: Product[] }>('/api/products?page_size=100'), api<Category[]>('/api/categories'), api<Supplier[]>('/api/suppliers'),
    ])
    setProducts(p.items.filter(item => item.status !== 'archived')); setCategories(c); setSuppliers(s)
  }
  useEffect(() => { load().catch(e => setError(e.message)) }, [])

  const shown = useMemo(() => products.filter(p => `${p.sku} ${p.name} ${p.category_name}`.toLowerCase().includes(query.toLowerCase())), [products, query])
  function start() { setBusy(true); setError(''); setNotice('') }
  async function done(message: string) { await load(); setNotice(message); setBusy(false) }
  function fail(e: unknown) { setError(e instanceof Error ? e.message : 'The change could not be saved.'); setBusy(false) }

  async function createProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); start(); const formElement = e.currentTarget; const f = new FormData(formElement)
    const minimum = Number(f.get('minimum'))
    try {
      await api('/api/products', { method: 'POST', body: JSON.stringify({ sku: f.get('sku'), name: f.get('name'), category_id: Number(f.get('category')), supplier_id: Number(f.get('supplier')), price: Number(f.get('price')), current_stock: Number(f.get('stock')), minimum_stock: minimum, maximum_stock: Math.max(200, Number(f.get('stock'))), reorder_point: minimum, safety_stock: minimum, lead_time_days: 3, unit: 'unit', status: 'active' }) })
      const cost = Number(f.get('cost'))
      if (cost > 0) { const costs = JSON.parse(localStorage.getItem('stockwise_unit_costs') || '{}') as Record<string, number>; costs[String(f.get('sku'))] = cost; localStorage.setItem('stockwise_unit_costs', JSON.stringify(costs)) }
      formElement.reset(); await done('Product added to the live catalog.')
    } catch (err) { fail(err) }
  }

  async function recordSale(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); start(); const f = new FormData(e.currentTarget)
    try {
      await api('/api/sales', { method: 'POST', body: JSON.stringify({ product_id: Number(f.get('product')), quantity_sold: Number(f.get('quantity')), unit_price: Number(f.get('price')), date: f.get('date'), channel: f.get('channel'), location: 'Main Store' }) })
      e.currentTarget.reset(); await done('Sale recorded. Stock and revenue have been updated.')
    } catch (err) { fail(err) }
  }

  async function adjustStock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); start(); const f = new FormData(e.currentTarget); const type = String(f.get('type'))
    let delta = Number(f.get('delta')); if (type === 'waste') delta = -Math.abs(delta); else if (type === 'receipt') delta = Math.abs(delta)
    try {
      await api(`/api/inventory/${Number(f.get('product'))}/adjust`, { method: 'POST', body: JSON.stringify({ quantity_delta: delta, transaction_type: type, note: String(f.get('notes') || '') }) })
      e.currentTarget.reset(); await done('Stock adjustment recorded in the audit log.')
    } catch (err) { fail(err) }
  }

  async function importRows(e: FormEvent) {
    e.preventDefault(); start()
    const rows = paste.trim().split(/\r?\n/).filter(Boolean).map(line => line.split(',').map(value => value.trim()))
    const data = rows[0]?.[0]?.toLowerCase() === 'sku' ? rows.slice(1) : rows
    if (!categories.length || !suppliers.length) { setError('Add at least one category and supplier before importing products.'); setBusy(false); return }
    try {
      for (const row of data) {
        if (row.length < 5) throw new Error('Each CSV row needs SKU, Product Name, Category, Stock, and Selling Price.')
        const category = categories.find(c => c.name.toLowerCase() === row[2].toLowerCase()) || categories[0]
        await api('/api/products', { method: 'POST', body: JSON.stringify({ sku: row[0], name: row[1], category_id: category.id, supplier_id: suppliers[0].id, price: Number(row[4]), current_stock: Number(row[3]), minimum_stock: 10, maximum_stock: 200, reorder_point: 10, safety_stock: 10, lead_time_days: 3, unit: 'unit', status: 'active' }) })
      }
      setPaste(''); await done(`${data.length} product${data.length === 1 ? '' : 's'} imported.`)
    } catch (err) { fail(err) }
  }

  async function quickRestock(product: Product) {
    start()
    try { await api(`/api/inventory/${product.id}/adjust`, { method: 'POST', body: JSON.stringify({ quantity_delta: 10, transaction_type: 'receipt', note: 'Quick +10 restock' }) }); await done(`${product.name} restocked by 10 units.`) } catch (err) { fail(err) }
  }

  async function archive(product: Product) {
    if (!window.confirm(`Archive ${product.name}?`)) return
    start(); try { await api(`/api/products/${product.id}`, { method: 'DELETE' }); await done(`${product.name} archived.`) } catch (err) { fail(err) }
  }

  async function editPrice(product: Product) {
    const name = window.prompt('Product name', product.name)
    if (name === null || name.trim().length < 2) return
    const value = window.prompt(`Selling price for ${name}`, String(product.price))
    if (value === null || !Number.isFinite(Number(value)) || Number(value) <= 0) return
    start()
    try {
      await api(`/api/products/${product.id}`, { method: 'PUT', body: JSON.stringify({ sku: product.sku, name: name.trim(), category_id: product.category_id, supplier_id: product.supplier_id, price: Number(value), current_stock: product.current_stock, minimum_stock: product.minimum_stock || 0, maximum_stock: product.maximum_stock || 200, reorder_point: product.reorder_point, safety_stock: product.safety_stock || 0, lead_time_days: product.lead_time_days || 3, unit: product.unit, status: product.status }) })
      await done('Product price updated.')
    } catch (err) { fail(err) }
  }

  return <div className="data-studio">
    <header className="page-header">
      <div><p className="eyebrow">CATALOG OPERATIONS</p><h1>Data Input &amp; Management</h1><p>Add products, record sales, and keep every stock movement traceable.</p></div>
      <button className="primary-button" onClick={() => setTab('product')}><Plus size={16}/>Add product</button>
    </header>
    {notice && <div className="studio-notice" role="status">{notice}<button className="text-action" onClick={() => setNotice('')}>Dismiss</button></div>}
    {error && <div className="error-state" role="alert">{error}</div>}
    <section className="studio-workspace">
      <div className="studio-tabs" role="tablist" aria-label="Data actions">{tabs.map(({ key, label, icon: Icon }) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'studio-tab active' : 'studio-tab'} onClick={() => { setTab(key); setError(''); setNotice('') }}><Icon size={16}/><span>{label}</span></button>)}</div>
      <div className="studio-form-area">
        {tab === 'product' && <form onSubmit={createProduct}>
          <div className="form-title"><div><h2>Add a product</h2><p>New catalog records are available immediately across Stockwise.</p></div></div>
          <div className="form-grid studio-fields">
            <label>Product name<input name="name" placeholder="e.g. Basmati Rice" required minLength={2}/></label><label>SKU<input name="sku" placeholder="STK-031" required minLength={2}/></label>
            <label>Category<select name="category" required>{categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Supplier<select name="supplier" required>{suppliers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
            <label>Unit cost price (₹)<input name="cost" type="number" min="0" step="0.01" placeholder="0.00"/></label><label>Selling price (₹)<input name="price" type="number" min="0.01" step="0.01" required placeholder="0.00"/></label>
            <label>Initial stock quantity<input name="stock" type="number" min="0" required defaultValue="0"/></label><label>Minimum reorder threshold<input name="minimum" type="number" min="0" required defaultValue="10"/></label>
          </div><div className="form-footer"><span>Fields marked by the browser as required must be completed.</span><button className="primary-button" disabled={busy}><PackagePlus size={16}/>{busy ? 'Saving…' : 'Save product'}</button></div>
        </form>}
        {tab === 'sale' && <form onSubmit={recordSale}>
          <div className="form-title"><div><h2>Record a sales transaction</h2><p>Sale quantities are deducted from available stock automatically.</p></div></div><div className="form-grid studio-fields">
            <label className="field-wide">Product<select name="product" required>{products.map(p => <option value={p.id} key={p.id}>{p.name} · {p.current_stock} available</option>)}</select></label>
            <label>Quantity sold<input name="quantity" type="number" min="1" required defaultValue="1"/></label><label>Unit sale price (₹)<input name="price" type="number" min="0.01" step="0.01" required/></label>
            <label>Payment / channel<select name="channel"><option value="store">Retail store</option><option value="online">Online</option><option value="wholesale">Wholesale</option><option value="marketplace">Marketplace</option></select></label><label>Date<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required/></label>
          </div><div className="form-footer"><span>Revenue and daily sales charts refresh from the saved transaction.</span><button className="primary-button" disabled={busy}><ShoppingCart size={16}/>{busy ? 'Saving…' : 'Record sale'}</button></div>
        </form>}
        {tab === 'adjust' && <form onSubmit={adjustStock}>
          <div className="form-title"><div><h2>Stock adjustment &amp; audit</h2><p>Adjustments are saved with a reason and note in the inventory log.</p></div></div><div className="form-grid studio-fields">
            <label className="field-wide">Product<select name="product" required>{products.map(p => <option value={p.id} key={p.id}>{p.name} · {p.current_stock} available</option>)}</select></label>
            <label>Adjustment type<select name="type"><option value="receipt">Received shipment</option><option value="waste">Damaged / expired</option><option value="adjustment">Stock count correction</option></select></label><label>Quantity delta<input name="delta" type="number" min="1" required placeholder="Quantity to add or remove"/></label>
            <label className="field-wide">Notes<input name="notes" maxLength={500} placeholder="Reason, reference, or audit note"/></label>
          </div><div className="form-footer"><span>Received adds stock; damaged or expired removes stock.</span><button className="primary-button" disabled={busy}><SlidersHorizontal size={16}/>{busy ? 'Saving…' : 'Save adjustment'}</button></div>
        </form>}
        {tab === 'bulk' && <form onSubmit={importRows}>
          <div className="form-title"><div><h2>Bulk CSV / fast paste</h2><p>Paste one product per line. Existing category names are matched automatically.</p></div></div>
          <label className="bulk-label">CSV data<textarea value={paste} onChange={e => setPaste(e.target.value)} rows={7} placeholder={'SKU,Product Name,Category,Stock,Selling Price\nSTK-031,Basmati Rice,Grains,42,185.00'} required/></label>
          <div className="form-footer"><span>Column order: SKU, Product Name, Category, Stock, Selling Price.</span><button className="primary-button" disabled={busy}><ArrowDownToLine size={16}/>{busy ? 'Importing…' : 'Import products'}</button></div>
        </form>}
      </div>
    </section>
    <section className="panel table-panel studio-table-panel">
      <div className="table-toolbar"><div><strong>Current inventory</strong><small>{shown.length} products · live catalog</small></div><label className="search"><Search size={16}/><input aria-label="Search inventory" placeholder="Search SKU, product, category" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
      <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Product name</th><th>Category</th><th>Stock level</th><th>Status</th><th>Unit price</th><th>Actions</th></tr></thead><tbody>
        {shown.map(p => { const low = p.current_stock <= p.reorder_point; return <tr key={p.id}><td className="sku-cell">{p.sku}</td><td><strong>{p.name}</strong></td><td>{p.category_name || '—'}</td><td>{p.current_stock} {p.unit}</td><td><span className={low ? 'stock-status low' : 'stock-status'}><i/>{low ? 'Low stock' : 'In stock'}</span></td><td>₹{p.price.toLocaleString('en-IN')}</td><td><div className="row-actions"><button className="row-action" title="Edit product name and selling price" aria-label={`Edit ${p.name}`} onClick={() => editPrice(p)}>Edit</button><button className="row-action restock-action" title="Quick +10 restock" onClick={() => quickRestock(p)} disabled={busy}><Plus size={13}/>+10</button><button className="row-action delete-action" title="Archive product" aria-label={`Delete ${p.name}`} onClick={() => archive(p)}><Trash2 size={14}/></button></div></td></tr> })}
        {!shown.length && <tr><td colSpan={7} className="empty-row">No matching products.</td></tr>}
      </tbody></table></div>
    </section>
  </div>
}
