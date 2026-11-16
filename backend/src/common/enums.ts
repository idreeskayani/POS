export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  CASHIER = 'CASHIER',
  WAITER = 'WAITER',
}
export const ORG_WIDE_ROLES: Role[] = [Role.OWNER, Role.ADMIN];

export enum OrderStatus {
  OPEN = 'OPEN',
  SENT = 'SENT',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}
export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
}
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  ONLINE = 'ONLINE',
}
export enum TableStatus {
  FREE = 'FREE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
}
