import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, Minus, Plus, Printer, Search, ShoppingBag, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'

type Product = { id: number; name: string; sku: string; price: number; stock: number; expiry_date: string | null; batch_number: string | null; category_is_grocery: boolean; is_weight_based: boolean; weight_unit: 'kg' | 'g'; default_weight_g: number; weight_increment_g: number; minimum_weight_g: number; maximum_weight_g: number; weight_stock_g: number | null }
type CartLine = { product: Product; quantity: number; selectedWeightG?: number; weightUnit?: 'kg' | 'g'; weightDraft?: string; weightError?: string }
type Invoice = { invoice_id: string; customer: { name: string; phone: string | null; customer_id: string | null }; items: { product_id: number; name: string; quantity: number; unit_price: number; total: number; selected_weight_g?: number | null; weight_unit?: 'kg' | 'g' | null }[]; subtotal: number; discount: number; tax: number; total: number; payment_method: string; payment_status: string; created_at: string }
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
const formatWeight = (grams: number, unit: 'kg' | 'g') => unit === 'kg' ? String(Number((grams / 1000).toFixed(3))) : String(grams)
const toGrams = (value: number, unit: 'kg' | 'g') => Math.round(value * (unit === 'kg' ? 1000 : 1))
const weightedTotal = (pricePerKg: number, grams: number) => Math.round(Math.round(pricePerKg * 100) * grams / 1000) / 100
function getSavedCart(): CartLine[] {
  try {
    const value = JSON.parse(sessionStorage.getItem('inventory_checkout_cart') || '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

export default function CheckoutPage() {
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartLine[]>(getSavedCart)
  const [discount, setDiscount] = useState(0)
  const [tax, setTax] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountReceived, setAmountReceived] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState<Invoice | null>(null)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      api<Product[]>(`/api/checkout/products?q=${encodeURIComponent(query)}`)
        .then(items => { if (!cancelled) { setProducts(items); setCart(current => current.map(line => { const fresh = items.find(product => product.id === line.product.id); if (!fresh) return line; const next = { ...line, product: fresh }; if (fresh.is_weight_based && (line.selectedWeightG || 0) > (fresh.weight_stock_g || 0)) next.weightError = `Only ${fresh.weight_stock_g || 0} g is currently available.`; return next })) } })
        .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load products.') })
    }, query ? 200 : 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    sessionStorage.setItem('inventory_checkout_cart', JSON.stringify(cart))
  }, [cart])

  const actualSubtotal = useMemo(() => cart.reduce((sum, line) => sum + (line.product.is_weight_based ? weightedTotal(line.product.price, line.selectedWeightG || 0) : line.product.price * line.quantity), 0), [cart])
  const grandTotal = Math.max(0, actualSubtotal - discount + tax)
  const hasInvalidWeight = cart.some(line => line.product.is_weight_based && Boolean(line.weightError))
  const setQuantity = (productId: number, quantity: number) => setCart(current => current.map(line => line.product.id === productId ? { ...line, quantity: Math.max(1, Math.min(line.product.stock, quantity)) } : line))
  const addProduct = (product: Product) => {
    setError('')
    const available = product.is_weight_based ? (product.weight_stock_g || 0) : product.stock
    if (available < 1) { setError(`${product.name} is out of stock.`); return }
    if (product.expiry_date && new Date(`${product.expiry_date}T00:00:00`) < new Date(new Date().toDateString())) { setError(`${product.name} is expired and cannot be sold.`); return }
    if (product.is_weight_based) {
      const existing = cart.find(line => line.product.id === product.id)
      const grams = (existing?.selectedWeightG || 0) + (existing ? product.weight_increment_g : product.default_weight_g)
      const maximum = Math.min(product.maximum_weight_g, available)
      if (grams > maximum) { setError(`Only ${formatWeight(maximum, product.weight_unit)} ${product.weight_unit} is available for ${product.name}.`); return }
      if (grams < product.minimum_weight_g) { setError(`${product.name} must be sold in at least ${formatWeight(product.minimum_weight_g, product.weight_unit)} ${product.weight_unit}.`); return }
      const display = product.weight_unit
      setCart(current => {
        const line = current.find(item => item.product.id === product.id)
        if (line) return current.map(item => item.product.id === product.id ? { ...item, selectedWeightG: grams, weightUnit: display, weightDraft: formatWeight(grams, display), weightError: '' } : item)
        return [...current, { product, quantity: 1, selectedWeightG: grams, weightUnit: display, weightDraft: formatWeight(grams, display) }]
      })
      return
    }
    setCart(current => {
      const existing = current.find(line => line.product.id === product.id)
      if (existing) return current.map(line => line.product.id === product.id ? { ...line, quantity: Math.min(product.stock, line.quantity + 1) } : line)
      return [...current, { product, quantity: 1 }]
    })
  }
  const changeWeight = (productId: number, value: string, unit: 'kg' | 'g') => {
    setCart(current => current.map(line => {
      if (line.product.id !== productId) return line
      const grams = toGrams(Number(value), unit)
      const available = line.product.weight_stock_g || 0
      let weightError = ''
      if (value.trim() === '' || !Number.isFinite(Number(value))) weightError = 'Enter a numeric weight.'
      else if (grams <= 0) weightError = 'Weight must be greater than zero.'
      else if (grams < line.product.minimum_weight_g) weightError = `Minimum is ${line.product.minimum_weight_g} g.`
      else if (grams > line.product.maximum_weight_g) weightError = `Maximum is ${line.product.maximum_weight_g} g.`
      else if (grams > available) weightError = `Only ${available} g is available.`
      return { ...line, weightUnit: unit, weightDraft: value, selectedWeightG: weightError ? line.selectedWeightG : grams, weightError }
    }))
  }
  const switchWeightUnit = (productId: number, unit: 'kg' | 'g') => setCart(current => current.map(line => line.product.id === productId && line.selectedWeightG ? { ...line, weightUnit: unit, weightDraft: formatWeight(line.selectedWeightG, unit), weightError: '' } : line))
  const adjustWeight = (line: CartLine, direction: -1 | 1) => {
    const currentGrams = line.selectedWeightG || 0
    const next = currentGrams + direction * line.product.weight_increment_g
    const max = Math.min(line.product.maximum_weight_g, line.product.weight_stock_g || 0)
    if (next < line.product.minimum_weight_g || next > max) return
    setCart(current => current.map(item => item.product.id === line.product.id ? { ...item, selectedWeightG: next, weightDraft: formatWeight(next, item.weightUnit || item.product.weight_unit), weightError: '' } : item))
  }
  async function completeSale() {
    setBusy(true); setError('')
    try {
      const completed = await api<Invoice>('/api/checkout/sales', { method: 'POST', body: JSON.stringify({
        items: cart.map(line => ({ product_id: line.product.id, quantity: line.quantity, ...(line.product.is_weight_based ? { selected_weight_g: line.selectedWeightG, weight_unit: line.weightUnit } : {}) })), discount, tax,
        customer_name: customerName.trim() || 'Walk-in Customer', customer_phone: customerPhone.trim() || null,
        customer_id: customerId.trim() || null, payment_method: paymentMethod,
        amount_received: paymentMethod === 'cash' ? Number(amountReceived) : null,
      }) })
      setInvoice(completed); setCart([]); setProducts(current => current.map(p => { const sold = completed.items.find(item => item.product_id === p.id); return sold ? (p.is_weight_based ? { ...p, weight_stock_g: Math.max(0, (p.weight_stock_g || 0) - (sold.selected_weight_g || 0)) } : { ...p, stock: Math.max(0, p.stock - sold.quantity) }) : p })); setDiscount(0); setTax(0); setPaymentOpen(false); setQuery('')
    } catch (err) {
      setError(err instanceof Error ? `${err.message}\nUnable to complete the sale. Please try again.` : 'Unable to complete the sale. Please try again.')
    } finally { setBusy(false) }
  }

  function downloadInvoice() {
    if (!invoice) return
    const safe = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
    const rows = invoice.items.map(item => `<tr><td>${safe(item.name)}${item.selected_weight_g ? ` (${item.weight_unit === 'kg' ? (item.selected_weight_g / 1000).toFixed(3).replace(/\\.?0+$/, '') : item.selected_weight_g} ${safe(item.weight_unit || 'g')})` : ''}</td><td>${item.quantity}</td><td>${money(item.unit_price)}${item.selected_weight_g ? ' / kg' : ''}</td><td>${money(item.total)}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safe(invoice.invoice_id)}</title><style>@page{size:A4;margin:18mm}body{font:14px Arial,sans-serif;color:#222;max-width:760px;margin:40px auto;padding:24px}@media print{body{margin:0;max-width:none;padding:0}}h1{text-align:center}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;border-bottom:1px solid #ddd;padding:10px}.totals{margin-left:auto;width:260px}.totals div{display:flex;justify-content:space-between;padding:5px}.grand{font-weight:bold;border-top:2px solid #222}</style></head><body><h1>Stockwise AI</h1><p>Invoice: ${safe(invoice.invoice_id)} · ${new Date(invoice.created_at).toLocaleString()}</p><p>Customer: ${safe(invoice.customer.name)}${invoice.customer.phone ? ` · ${safe(invoice.customer.phone)}` : ''}</p><table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="totals"><div><span>Subtotal</span><span>${money(invoice.subtotal)}</span></div><div><span>Discount</span><span>${money(invoice.discount)}</span></div><div><span>Tax</span><span>${money(invoice.tax)}</span></div><div class="grand"><span>Total paid</span><span>${money(invoice.total)}</span></div></div><p>Payment: ${safe(invoice.payment_method.toUpperCase())} · ${safe(invoice.payment_status)}</p><p style="text-align:center;margin-top:36px">Thank you for your purchase!</p></body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const link = document.createElement('a'); link.href = url; link.download = `${invoice.invoice_id}.html`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <div className="checkout-page">
    <header className="page-header"><div><p className="eyebrow">POINT OF SALE</p><h1>Checkout</h1><p>Search products, build a bill, and complete a sale.</p></div>{invoice && <button className="secondary-button" onClick={() => setInvoice(null)}><ShoppingBag size={15}/> New sale</button>}</header>
    {error && <div className="checkout-error" role="alert">{error}</div>}
    {invoice ? <section className="panel checkout-success"><div className="success-title"><CheckCircle2/><div><h2>Payment successful</h2><p>Invoice {invoice.invoice_id} · {money(invoice.total)} paid by {invoice.payment_method.toUpperCase()}</p></div></div><Receipt invoice={invoice}/><div className="checkout-actions"><button className="secondary-button" onClick={() => window.print()}><Printer size={15}/> Print receipt</button><button className="primary-button" onClick={downloadInvoice}><Download size={15}/> Download invoice</button></div></section> : <div className="checkout-grid">
      <section className="panel checkout-products"><div className="panel-heading"><div><h2>Find products</h2><p>Search by product name or SKU.</p></div></div><label className="checkout-search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search product..." aria-label="Search product"/></label><div className="checkout-results">{products.filter(p => !query || `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase())).map(product => { const available = product.is_weight_based ? (product.weight_stock_g || 0) : product.stock; return <article className="checkout-product" key={product.id}><div><strong>{product.name}</strong><small>SKU: {product.sku} · {product.is_weight_based ? `${money(product.price)} / kg · Stock: ${formatWeight(available, product.weight_unit)} ${product.weight_unit}` : `${money(product.price)} · Stock: ${product.stock}`}{product.expiry_date ? ` · Expiry: ${new Date(`${product.expiry_date}T00:00:00`).toLocaleDateString()}` : ''}</small>{available <= 0 && <small className="danger-text">Out of stock</small>}</div><button className="secondary-button" disabled={available <= 0} onClick={() => addProduct(product)}><Plus size={15}/> Add</button></article>})}{products.length === 0 && <p className="checkout-empty">{query ? 'No matching products found.' : 'No active products available.'}</p>}</div></section>
      <section className="panel checkout-bill"><div className="panel-heading"><div><h2>Current bill</h2><p>Customer: {customerName.trim() || 'Walk-in Customer'}</p></div><span className="checkout-count">{cart.reduce((n, l) => n + l.quantity, 0)} items</span></div>
        <div className="customer-fields"><input aria-label="Customer name" placeholder="Customer name (optional)" value={customerName} onChange={e => setCustomerName(e.target.value)}/><input aria-label="Phone number" placeholder="Phone number (optional)" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)}/><input aria-label="Customer ID" placeholder="Customer ID (optional)" value={customerId} onChange={e => setCustomerId(e.target.value)}/></div>
        <div className="checkout-cart">{cart.length ? cart.map(line => { const { product, quantity } = line; const available = product.is_weight_based ? (product.weight_stock_g || 0) : product.stock; const unit = line.weightUnit || product.weight_unit; const lineTotal = product.is_weight_based ? weightedTotal(product.price, line.selectedWeightG || 0) : product.price * quantity; return <div className={`cart-line ${product.is_weight_based ? 'weight-cart-line' : ''}`} key={product.id}><div className="cart-item-name"><strong>{product.name}</strong><small>{product.is_weight_based ? `${money(product.price)} / kg · ${formatWeight(available, unit)} ${unit} available` : `${money(product.price)} each · ${product.stock} available`}</small></div>{product.is_weight_based ? <div className="weight-management"><div className="quantity-controls"><button aria-label={`Decrease ${product.name} weight`} disabled={(line.selectedWeightG || 0) - product.weight_increment_g < product.minimum_weight_g} onClick={() => adjustWeight(line, -1)}><Minus size={13}/></button><span>{formatWeight(line.selectedWeightG || 0, unit)} {unit}</span><button aria-label={`Increase ${product.name} weight`} disabled={(line.selectedWeightG || 0) + product.weight_increment_g > Math.min(product.maximum_weight_g, available)} onClick={() => adjustWeight(line, 1)}><Plus size={13}/></button></div><label className="weight-custom">Custom weight<input aria-label={`Custom weight for ${product.name}`} type="number" min={unit === 'kg' ? product.minimum_weight_g / 1000 : product.minimum_weight_g} max={unit === 'kg' ? Math.min(product.maximum_weight_g, available) / 1000 : Math.min(product.maximum_weight_g, available)} step={unit === 'kg' ? '0.001' : '1'} value={line.weightDraft || ''} onChange={e => changeWeight(product.id, e.target.value, unit)}/><select aria-label={`Weight unit for ${product.name}`} value={unit} onChange={e => switchWeightUnit(product.id, e.target.value as 'kg' | 'g')}><option value="kg">kg</option><option value="g">g</option></select></label>{line.weightError && <small className="weight-error" role="alert">{line.weightError}</small>}</div> : <div className="quantity-controls"><button aria-label={`Decrease ${product.name}`} disabled={quantity <= 1} onClick={() => setQuantity(product.id, quantity - 1)}><Minus size={13}/></button><span>{quantity}</span><button aria-label={`Increase ${product.name}`} disabled={quantity >= product.stock} onClick={() => setQuantity(product.id, quantity + 1)}><Plus size={13}/></button></div>}<strong className="cart-line-total">{money(lineTotal)}</strong><button className="remove-line" aria-label={`Remove ${product.name}`} onClick={() => setCart(items => items.filter(item => item.product.id !== product.id))}><Trash2 size={15}/></button></div>}) : <div className="checkout-empty"><ShoppingBag size={24}/><span>Your bill is empty. Add products to start a sale.</span></div>}</div>
        <div className="checkout-adjustments"><label>Discount<input type="number" min="0" max={actualSubtotal} step="0.01" value={discount} onChange={e => setDiscount(Math.min(actualSubtotal, Math.max(0, Number(e.target.value))))}/></label><label>Tax<input type="number" min="0" step="0.01" value={tax} onChange={e => setTax(Math.max(0, Number(e.target.value)))}/></label></div><div className="checkout-totals"><div><span>Subtotal</span><strong>{money(actualSubtotal)}</strong></div><div><span>Discount</span><strong>−{money(discount)}</strong></div><div><span>Tax</span><strong>{money(tax)}</strong></div><div className="total-row"><span>Total</span><strong>{money(grandTotal)}</strong></div></div><button className="primary-button checkout-pay" disabled={!cart.length || grandTotal <= 0 || hasInvalidWeight} onClick={() => { setPaymentOpen(true); setAmountReceived(grandTotal.toFixed(2)) }}>Pay {money(grandTotal)}</button>
      </section>
    </div>}
    {paymentOpen && <div className="checkout-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setPaymentOpen(false) }}><section className="panel payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-heading"><button className="payment-close" aria-label="Close payment" disabled={busy} onClick={() => setPaymentOpen(false)}><X size={18}/></button><p className="eyebrow">PAYMENT</p><h2 id="payment-heading">Collect {money(grandTotal)}</h2><p>Choose the payment method to complete the sale.</p><div className="payment-methods">{['cash', 'upi', 'card', 'other'].map(method => <label key={method}><input type="radio" name="payment" value={method} checked={paymentMethod === method} onChange={() => setPaymentMethod(method)}/>{method.toUpperCase()}</label>)}</div>{paymentMethod === 'cash' ? <><label className="payment-amount">Amount received<input type="number" min={grandTotal} step="0.01" value={amountReceived} onChange={e => setAmountReceived(e.target.value)}/></label><div className="change-due">Change due <strong>{money(Math.max(0, Number(amountReceived || 0) - grandTotal))}</strong></div></> : <div className="payment-pending">Payment status: pending confirmation</div>}{error && <div className="checkout-error" role="alert">{error}</div>}<button className="primary-button checkout-pay" disabled={busy || (paymentMethod === 'cash' && Number(amountReceived) < grandTotal)} onClick={completeSale}>{busy ? 'Completing sale…' : paymentMethod === 'cash' ? 'Confirm cash payment' : 'Confirm payment'}</button></section></div>}
  </div>
}

function Receipt({ invoice }: { invoice: Invoice }) { return <div className="checkout-receipt"><h2>Stockwise AI</h2><p>Invoice: {invoice.invoice_id}<br/>{new Date(invoice.created_at).toLocaleString()}</p><p>Customer: {invoice.customer.name}</p><div className="receipt-items">{invoice.items.map(item => <div key={item.product_id}><span>{item.name}{item.selected_weight_g ? ` · ${item.weight_unit === 'kg' ? formatWeight(item.selected_weight_g, 'kg') : item.selected_weight_g} ${item.weight_unit}` : ` × ${item.quantity}`}</span><strong>{money(item.total)}</strong></div>)}</div><div className="receipt-total"><div><span>Subtotal</span><span>{money(invoice.subtotal)}</span></div><div><span>Discount</span><span>{money(invoice.discount)}</span></div><div><span>Tax</span><span>{money(invoice.tax)}</span></div><div className="total-row"><strong>Total paid</strong><strong>{money(invoice.total)}</strong></div></div><p className="receipt-thanks">Payment: {invoice.payment_method.toUpperCase()} · {invoice.payment_status}<br/>Thank you for your purchase!</p></div> }
