import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProductsPage from './ProductsPage'

vi.mock('../lib/api', () => ({
  api: vi.fn((url: string) => {
    if (url.startsWith('/api/products')) {
      return Promise.resolve({
        items: [
          {
            id: 1,
            sku: 'SKU-001',
            name: 'Basmati Rice 5kg',
            category_name: 'Grains',
            supplier_name: 'Agro Farms',
            price: 450,
            current_stock: 40,
            reorder_point: 20,
            unit: 'pack',
            status: 'active'
          }
        ]
      })
    }
    if (url.startsWith('/api/categories')) {
      return Promise.resolve([{ id: 1, name: 'Grains' }])
    }
    if (url.startsWith('/api/suppliers')) {
      return Promise.resolve([{ id: 1, name: 'Agro Farms' }])
    }
    return Promise.resolve([])
  })
}))

describe('ProductsPage', () => {
  it('renders products header, batch receiving, and add product buttons', async () => {
    render(<ProductsPage />)
    expect(screen.getByRole('heading', { name: /products & inventory/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /receive batch/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add product/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search by name, sku or category/i)).toBeInTheDocument()
  })
})
