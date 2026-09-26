import { FormEvent, useEffect, useState } from 'react'
import { Boxes, PackagePlus, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../lib/api'
import type { InventoryBatch, Product } from '../types'
import { StatusBadge } from '../components/StatusBadge'

type Category = { id: number; name: string; is_grocery?: boolean; default_weight_unit?: 'kg' | 'g'; default_weight_g?: number; weight_increment_g?: number; minimum_weight_g?: number; maximum_weight_g?: number }
type Supplier = { id: number; name: string }

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [query, setQuery] = useState('')
  const [showProductForm, setShowProductForm] = useState(false)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [productBatches, setProductBatches] = useState<InventoryBatch[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [weightBased, setWeightBased] = useState(false)
  const [weightUnit, setWeightUnit] = useState<'kg' | 'g'>('kg')
  const selectedCategory = categories.find(category => String(category.id) === categoryId) || categories[0]

  const load = () => api<{ items: Product[] }>('/api/products?page_size=100').then(r => setProducts(r.items)).catch(e => setError(e.message))

  useEffect(() => {
    load()
    api<Category[]>('/api/categories').then(setCategories)
    api<Supplier[]>('/api/suppliers').then(setSuppliers)
  }, [])

  async function openProductDetail(p: Product) {
    setSelectedProduct(p)
    setLoadingBatches(true)
    try {
      const full = await api<Product & { batches: InventoryBatch[] }>(`/api/products/${p.id}`)
      setSelectedProduct(full)
      setProductBatches(full.batches || [])
    } catch {
      setProductBatches([])
    } finally {
      setLoadingBatches(false)
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const body = {
      sku: String(form.get('sku')),
      name: String(form.get('name')),
      category_id: Number(form.get('category')),
      supplier_id: Number(form.get('supplier')),
      price: Number(form.get('price')),
      minimum_stock: Number(form.get('minimum')),
      maximum_stock: Number(form.get('maximum')),
      reorder_point: Number(form.get('reorder')),
      safety_stock: Number(form.get('safety')),
      lead_time_days: Number(form.get('lead')),
      unit: weightBased ? 'kg' : 'pack',
      status: 'active',
      is_weight_based: weightBased,
      weight_unit: weightBased ? String(form.get('weight_unit')) : null,
      default_weight_g: weightBased ? Math.round(Number(form.get('default_weight')) * (String(form.get('weight_unit')) === 'kg' ? 1000 : 1)) : null,
      weight_increment_g: weightBased ? Math.round(Number(form.get('weight_increment')) * (String(form.get('weight_unit')) === 'kg' ? 1000 : 1)) : null,
      minimum_weight_g: weightBased ? Math.round(Number(form.get('minimum_weight')) * (String(form.get('weight_unit')) === 'kg' ? 1000 : 1)) : null,
      maximum_weight_g: weightBased ? Math.round(Number(form.get('maximum_weight')) * (String(form.get('weight_unit')) === 'kg' ? 1000 : 1)) : null,
      weight_stock_g: weightBased ? Math.round(Number(form.get('weight_stock')) * (String(form.get('weight_unit')) === 'kg' ? 1000 : 1)) : null,
      current_stock: weightBased ? 0 : Number(form.get('stock'))
    }
    try {
      await api('/api/products', { method: 'POST', body: JSON.stringify(body) })
      setShowProductForm(false)
      setSuccess('Product successfully created.')
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create product')
    }
  }

  async function handleReceiveBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const productId = Number(form.get('product_id'))
    const body = {
      product_id: productId,
      lot_number: String(form.get('lot_number')),
      quantity: Number(form.get('quantity')),
      received_date: String(form.get('received_date') || new Date().toISOString().slice(0, 10)),
      expiry_date: form.get('expiry_date') ? String(form.get('expiry_date')) : null
    }
    try {
      await api('/api/inventory/batches', { method: 'POST', body: JSON.stringify(body) })
      setShowBatchModal(false)
      setSuccess(`Batch ${body.lot_number} received successfully. Stock updated.`)
      load()
      if (selectedProduct && selectedProduct.id === productId) {
        openProductDetail(selectedProduct)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not receive batch')
    }
  }

  async function handleAdjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProduct) return
    setError('')
    const form = new FormData(event.currentTarget)
    const delta = Number(form.get('delta'))
    const type = String(form.get('type'))
    const note = String(form.get('note') || '')
    try {
      if (selectedProduct.is_weight_based) {
        const factor = selectedProduct.weight_unit === 'kg' ? 1000 : 1
        const result = await api<{ weight_stock_g: number }>(`/api/inventory/${selectedProduct.id}/weight-adjust`, {
          method: 'POST', body: JSON.stringify({ weight_delta_g: Math.round(delta * factor), transaction_type: type, note })
        })
        setSelectedProduct({ ...selectedProduct, weight_stock_g: result.weight_stock_g })
        setSuccess(`Weight stock adjusted. New balance: ${(result.weight_stock_g / 1000).toFixed(3)} kg`)
        load()
        return
      }
      const res = await api<{ current_stock: number }>(`/api/inventory/${selectedProduct.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ quantity_delta: delta, transaction_type: type, note })
      })
      setSelectedProduct({ ...selectedProduct, current_stock: res.current_stock })
      setSuccess(`Stock adjusted. New balance: ${res.current_stock}`)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Adjustment failed')
    }
  }

  const shown = products.filter(p =>
    `${p.name} ${p.sku} ${p.category_name}`.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">CATALOG & INVENTORY</p>
          <h1>Products & inventory</h1>
          <p>Live inventory balance, batch traceability, and expiry tracking.</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={() => setShowBatchModal(true)}>
            <PackagePlus size={17} />
            Receive Batch
          </button>
          <button className="primary-button" onClick={() => setShowProductForm(!showProductForm)}>
            <Plus size={17} />
            Add product
          </button>
        </div>
      </header>

      {success && (
        <div className="insight-strip" style={{ marginBottom: 16 }}>
          <span>{success}</span>
          <button className="icon-button" onClick={() => setSuccess('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}

      {showProductForm && (
        <form onSubmit={createProduct} className="panel product-form">
          <h2>New product</h2>
          <div className="form-grid">
            <label>SKU<input name="sku" required placeholder="INV-031" /></label>
            <label>Name<input name="name" required /></label>
            <label>Category
              <select name="category" required value={categoryId || categories[0]?.id || ''} onChange={e => { setCategoryId(e.target.value); const category = categories.find(c => String(c.id) === e.target.value); setWeightBased(false); if (category?.default_weight_unit) setWeightUnit(category.default_weight_unit) }}>
                {categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Supplier
              <select name="supplier" required>
                {suppliers.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>{weightBased ? 'Price per kilogram (₹)' : 'Price (₹)'}<input name="price" type="number" min="0.01" step="0.01" required /></label>
            {selectedCategory?.is_grocery && <label className="weight-product-toggle"><input type="checkbox" checked={weightBased} onChange={e => setWeightBased(e.target.checked)}/> Sold by weight</label>}
            {weightBased ? <>
              <input type="hidden" name="weight_unit" value={weightUnit}/><p className="weight-config-note">Default unit for this category: <strong>{weightUnit}</strong>. Stock is stored in grams.</p>
              <label>Available stock ({weightUnit})<input name="weight_stock" type="number" min="0" step={weightUnit === 'kg' ? '0.001' : '1'} required defaultValue="0"/></label>
              <label>Default selling weight ({weightUnit})<input name="default_weight" type="number" min="0.001" step={weightUnit === 'kg' ? '0.001' : '1'} required defaultValue={((selectedCategory.default_weight_g || 1000) / (weightUnit === 'kg' ? 1000 : 1))}/></label>
              <label>Weight increment ({weightUnit})<input name="weight_increment" type="number" min="0.001" step={weightUnit === 'kg' ? '0.001' : '1'} required defaultValue={((selectedCategory.weight_increment_g || 500) / (weightUnit === 'kg' ? 1000 : 1))}/></label>
              <label>Minimum sale weight ({weightUnit})<input name="minimum_weight" type="number" min="0.001" step={weightUnit === 'kg' ? '0.001' : '1'} required defaultValue={((selectedCategory.minimum_weight_g || 100) / (weightUnit === 'kg' ? 1000 : 1))}/></label>
              <label>Maximum sale weight ({weightUnit})<input name="maximum_weight" type="number" min="0.001" step={weightUnit === 'kg' ? '0.001' : '1'} required defaultValue={((selectedCategory.maximum_weight_g || 100000) / (weightUnit === 'kg' ? 1000 : 1))}/></label>
            </> : <label>Current stock<input name="stock" type="number" min="0" required /></label>}
            <label>Minimum stock<input name="minimum" type="number" min="0" defaultValue="10" required /></label>
            <label>Maximum stock<input name="maximum" type="number" min="1" defaultValue="200" required /></label>
            <label>Reorder point<input name="reorder" type="number" min="0" defaultValue="20" required /></label>
            <label>Safety stock<input name="safety" type="number" min="0" defaultValue="10" required /></label>
            <label>Lead time (days)<input name="lead" type="number" min="0" defaultValue="3" required /></label>
          </div>
          <button className="primary-button">Save product</button>
        </form>
      )}

      {showBatchModal && (
        <div className="modal-overlay" onClick={() => setShowBatchModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Receive stock batch</h2>
              <button className="icon-button" onClick={() => setShowBatchModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleReceiveBatch}>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <label>Select Product
                  <select name="product_id" defaultValue={selectedProduct?.id || products[0]?.id} required>
                    {products.filter(p => !p.is_weight_based).map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku}) — Stock: {p.current_stock}</option>
                    ))}
                  </select>
                </label>
                <label>Lot / Batch Number
                  <input name="lot_number" required placeholder="LOT-2026-09A" />
                </label>
                <label>Quantity to Receive
                  <input name="quantity" type="number" min="1" defaultValue="20" required />
                </label>
                <label>Received Date
                  <input name="received_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
                </label>
                <label>Expiry Date (optional for non-perishables)
                  <input name="expiry_date" type="date" />
                </label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
                <button type="button" className="secondary-button" onClick={() => setShowBatchModal(false)}>Cancel</button>
                <button type="submit" className="primary-button">Confirm & Add to Stock</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedProduct && (
        <div className="drawer-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="drawer-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span className="eyebrow">{selectedProduct.category_name}</span>
                <h2 style={{ margin: '4px 0', fontSize: 22 }}>{selectedProduct.name}</h2>
                <small style={{ color: '#71817a' }}>SKU: {selectedProduct.sku} · Supplier: {selectedProduct.supplier_name}</small>
              </div>
              <button className="icon-button" onClick={() => setSelectedProduct(null)}><X size={20} /></button>
            </div>

            <div className="metric-chips">
              <div className="metric-chip">
                <small>Current Stock</small>
                <strong style={{ color: selectedProduct.is_weight_based ? '#147252' : selectedProduct.current_stock <= selectedProduct.reorder_point ? '#bd4536' : '#147252' }}>
                  {selectedProduct.is_weight_based ? `${((selectedProduct.weight_stock_g || 0) / 1000).toFixed(3).replace(/\.?0+$/, '')} kg` : `${selectedProduct.current_stock} ${selectedProduct.unit}`}
                </strong>
              </div>
              <div className="metric-chip">
                <small>Reorder Point</small>
                <strong>{selectedProduct.reorder_point}</strong>
              </div>
              <div className="metric-chip">
                <small>Unit Price</small>
                <strong>₹{selectedProduct.price}{selectedProduct.is_weight_based ? ' / kg' : ''}</strong>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Boxes size={16} /> Tracked Batches
                </h3>
                <button className="btn-sm btn-action" onClick={() => setShowBatchModal(true)}>
                  + Add Batch
                </button>
              </div>

              {loadingBatches ? (
                <div className="loading" style={{ padding: 16 }}>Loading batches…</div>
              ) : !productBatches.length ? (
                <div className="empty-state" style={{ padding: 16 }}>No active batches found for this product.</div>
              ) : (
                <div className="table-wrap" style={{ border: '1px solid #e3e9e5', borderRadius: 8 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Lot #</th>
                        <th>Qty</th>
                        <th>Received</th>
                        <th>Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productBatches.map(b => (
                        <tr key={b.id}>
                          <td><strong>{b.lot_number}</strong></td>
                          <td>{b.quantity}</td>
                          <td>{b.received_date}</td>
                          <td>
                            {b.expiry_date ? (
                              <span style={{ color: new Date(b.expiry_date) <= new Date() ? '#bd4536' : 'inherit' }}>
                                {b.expiry_date}
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="panel" style={{ padding: 16 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <SlidersHorizontal size={15} /> Quick Stock Adjustment
              </h3>
              <form onSubmit={handleAdjustStock}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12 }}>Adjustment Delta (+ / -){selectedProduct.is_weight_based ? ` (${selectedProduct.weight_unit})` : ''}
                    <input name="delta" type="number" step={selectedProduct.is_weight_based && selectedProduct.weight_unit === 'kg' ? '0.001' : '1'} required placeholder={selectedProduct.is_weight_based ? '+1 or -0.5' : '+10 or -5'} style={{ width: '100%', minHeight: 34, padding: '0 8px', border: '1px solid #d9e3de', borderRadius: 6 }} />
                  </label>
                  <label style={{ fontSize: 12 }}>Reason
                    <select name="type" style={{ width: '100%', minHeight: 34, border: '1px solid #d9e3de', borderRadius: 6 }}>
                      <option value="adjustment">Count Adjustment</option>
                      <option value="receipt">Stock Receipt</option>
                      <option value="waste">Damaged / Waste</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </label>
                </div>
                <label style={{ fontSize: 12, display: 'block', marginTop: 8 }}>Note
                  <input name="note" placeholder="Periodic audit adjustment" style={{ width: '100%', minHeight: 34, padding: '0 8px', border: '1px solid #d9e3de', borderRadius: 6 }} />
                </label>
                <button type="submit" className="primary-button" style={{ marginTop: 10, width: '100%', minHeight: 34 }}>
                  Apply Adjustment
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <section className="panel table-panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="Search by name, SKU or category"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, SKU or category"
            />
          </div>
          <span>{shown.length} products (click row to view details & batches)</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Supplier</th>
                <th>Current stock</th>
                <th>Reorder point</th>
                <th>Unit price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr
                  key={p.id}
                  className="clickable-row"
                  onClick={() => openProductDetail(p)}
                  title="Click to view details, active batches and shelf life"
                >
                  <td>
                    <strong>{p.name}</strong>
                    <small>{p.sku}</small>
                  </td>
                  <td>{p.category_name}</td>
                  <td>{p.supplier_name}</td>
                  <td className={p.is_weight_based ? '' : p.current_stock <= p.reorder_point ? 'danger-text' : ''}>
                    {p.is_weight_based ? `${((p.weight_stock_g || 0) / 1000).toFixed(3).replace(/\.?0+$/, '')} kg` : `${p.current_stock} ${p.unit}`}
                  </td>
                  <td>{p.reorder_point}</td>
                  <td>₹{p.price}{p.is_weight_based ? ' / kg' : ''}</td>
                  <td>
                    <StatusBadge value={p.current_stock <= p.reorder_point ? 'LOW' : p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
