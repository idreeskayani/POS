export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN';
export interface User { id: string; name: string; email: string; role: Role; branchId: string | null; organizationId: string }
export interface Branch { id: string; name: string; code: string; address: string | null; taxRate: number; currency: string }
export interface Table { id: string; label: string; seats: number; status: 'FREE' | 'OCCUPIED' | 'RESERVED' }
export interface MenuItem { id: string; name: string; description: string | null; price: number; isAvailable: boolean }
export interface Category { id: string; name: string; items: MenuItem[] }
export type OrderStatus = 'OPEN' | 'SENT' | 'PREPARING' | 'READY' | 'SERVED' | 'PAID' | 'CANCELLED';
export interface OrderItem { id: string; name: string; quantity: number; unitPrice: number; lineTotal: number; notes: string | null }
export interface Order {
  id: string; orderNumber: string; tableId: string | null; type: string; status: OrderStatus;
  subtotal: number; tax: number; discount: number; total: number; notes: string | null; createdAt: string; items: OrderItem[];
}
