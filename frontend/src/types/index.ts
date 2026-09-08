export type User = { id: number; email: string; full_name: string; role: 'admin' | 'manager' | 'staff'; is_active: boolean }
export type Product = { id: number; sku: string; name: string; category_name?: string; supplier_name?: string; price: number; current_stock: number; reorder_point: number; expiry_date?: string | null; unit: string; status: string }
export type Dashboard = { last_updated: string; kpis: Record<string, number>; sales_trend: { date: string; revenue: number; units: number }[]; category_sales: { name: string; value: number }[] }
