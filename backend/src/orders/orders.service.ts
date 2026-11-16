import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import { BranchesService } from '../branches/branches.service';
import { AuthUser } from '../common/auth';
import { OrderStatus, OrderType, PaymentMethod, Role, TableStatus } from '../common/enums';
import { Branch } from '../entities/branch.entity';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { DiningTable } from '../entities/dining-table.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export interface CreateOrderInput {
  id?: string; // client-generated UUID => idempotent create (safe to retry / offline sync)
  tableId?: string;
  type?: OrderType;
  notes?: string;
  discount?: number;
  items: { menuItemId: string; quantity: number; notes?: string }[];
}

// Simple flow: order is SENT to the kitchen, then PAID (via /pay) or CANCELLED.
// PREPARING / READY / SERVED are legacy values from earlier versions and stay payable/cancellable.
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.OPEN]: [OrderStatus.SENT, OrderStatus.CANCELLED],
  [OrderStatus.SENT]: [OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.CANCELLED],
  [OrderStatus.READY]: [OrderStatus.CANCELLED],
  [OrderStatus.SERVED]: [OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [],
  [OrderStatus.CANCELLED]: [],
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class OrdersService {
  constructor(
    private branches: BranchesService,
    private gateway: RealtimeGateway,
    @InjectDataSource() private ds: DataSource,
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(MenuItem) private menuItems: Repository<MenuItem>,
    @InjectRepository(BranchMenuItem) private overrides: Repository<BranchMenuItem>,
    @InjectRepository(DiningTable) private tables: Repository<DiningTable>,
    @InjectRepository(Payment) private payments: Repository<Payment>,
  ) {}

  async create(user: AuthUser, branchId: string, dto: CreateOrderInput) {
    const branch = await this.branches.getForUser(user, branchId);

    if (dto.id) {
      const existing = await this.orders.findOne({ where: { id: dto.id, branchId }, relations: { items: true } });
      if (existing) return existing; // idempotent replay
    }
    if (dto.tableId && !(await this.tables.exist({ where: { id: dto.tableId, branchId } }))) {
      throw new BadRequestException('Unknown table for this branch');
    }

    // Price every line from the server's menu (never trust client prices)
    const ids = [...new Set(dto.items.map((i) => i.menuItemId))];
    const [menu, ov] = await Promise.all([
      this.menuItems.find({ where: { id: In(ids), organizationId: user.orgId, isActive: true } }),
      this.overrides.find({ where: { branchId, menuItemId: In(ids) } }),
    ]);
    const menuById = new Map(menu.map((m) => [m.id, m]));
    const ovById = new Map(ov.map((o) => [o.menuItemId, o]));
    const lines = dto.items.map((line) => {
      const item = menuById.get(line.menuItemId);
      if (!item) throw new BadRequestException(`Menu item ${line.menuItemId} not found`);
      const o = ovById.get(item.id);
      if (o && !o.isAvailable) throw new BadRequestException(`"${item.name}" is not available at this branch`);
      const unitPrice = o?.price ?? item.basePrice;
      return { menuItemId: item.id, name: item.name, unitPrice, quantity: line.quantity, notes: line.notes ?? null, lineTotal: round2(unitPrice * line.quantity) };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const discount = Math.min(round2(dto.discount ?? 0), subtotal);
    const tax = round2(((subtotal - discount) * branch.taxRate) / 100);
    const total = round2(subtotal - discount + tax);

    const saved = await this.ds.transaction(async (m) => {
      // Lock the branch row so order numbers are gap-free and unique per branch
      const b = await m.findOne(Branch, { where: { id: branchId }, lock: { mode: 'pessimistic_write' } });
      b.orderSeq += 1;
      await m.save(b);
      const order = m.create(Order, {
        id: dto.id ?? randomUUID(),
        branchId,
        orderNumber: `${b.code}-${String(b.orderSeq).padStart(4, '0')}`,
        tableId: dto.tableId ?? null,
        type: dto.type ?? (dto.tableId ? OrderType.DINE_IN : OrderType.TAKEAWAY),
        status: OrderStatus.SENT,
        subtotal, tax, discount, total,
        notes: dto.notes ?? null,
        createdById: user.sub,
        items: lines.map((l) => m.create(OrderItem, l)),
      });
      await m.save(order);
      if (dto.tableId) await m.update(DiningTable, dto.tableId, { status: TableStatus.OCCUPIED });
      return order;
    });

    const full = await this.orders.findOneOrFail({ where: { id: saved.id }, relations: { items: true } });
    this.gateway.toKitchen(branchId, 'order:new', full);
    this.gateway.toBranch(branchId, 'order:updated', full);
    return full;
  }

  async list(user: AuthUser, branchId: string, status?: OrderStatus[], limit = 100) {
    await this.branches.getForUser(user, branchId);
    return this.orders.find({
      where: { branchId, ...(status?.length ? { status: In(status) } : {}) },
      relations: { items: true },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
    });
  }

  async get(user: AuthUser, branchId: string, id: string) {
    await this.branches.getForUser(user, branchId);
    const order = await this.orders.findOne({ where: { id, branchId }, relations: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async balance(user: AuthUser, branchId: string, id: string) {
    const order = await this.get(user, branchId, id);
    const paid = round2((await this.payments.find({ where: { orderId: id } })).reduce((s, p) => s + p.amount, 0));
    return { total: order.total, paid, balance: round2(Math.max(0, order.total - paid)) };
  }

  async setStatus(user: AuthUser, branchId: string, id: string, next: OrderStatus) {
    const order = await this.get(user, branchId, id);
    if (!TRANSITIONS[order.status].includes(next)) {
      throw new BadRequestException(`Cannot move order from ${order.status} to ${next}`);
    }
    if (next === OrderStatus.CANCELLED && order.status !== OrderStatus.SENT && user.role !== Role.OWNER && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an owner or admin can cancel this order');
    }
    order.status = next;
    await this.orders.save({ id: order.id, status: next });
    if (next === OrderStatus.CANCELLED) await this.releaseTableIfIdle(order);
    this.gateway.toBranch(branchId, 'order:updated', order);
    return order;
  }

  async pay(user: AuthUser, branchId: string, id: string, dto: { method: PaymentMethod; amount: number; reference?: string }) {
    const order = await this.get(user, branchId, id);
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) throw new BadRequestException(`Order is ${order.status}`);
    const paidSoFar = (await this.payments.find({ where: { orderId: id } })).reduce((s, p) => s + p.amount, 0);
    const due = round2(order.total - paidSoFar);
    if (dto.amount > due && dto.method !== PaymentMethod.CASH) throw new BadRequestException(`Amount exceeds balance due (${due})`);

    const applied = Math.min(dto.amount, due); // cash overpayment => change, only the due part is recorded
    await this.payments.save(this.payments.create({ orderId: id, branchId, method: dto.method, amount: applied, reference: dto.reference ?? null, receivedById: user.sub }));
    const balance = round2(due - applied);
    if (balance <= 0) {
      order.status = OrderStatus.PAID;
      await this.orders.save({ id: order.id, status: OrderStatus.PAID });
      await this.releaseTableIfIdle(order);
    }
    this.gateway.toBranch(branchId, 'order:updated', order);
    return { order, paid: round2(paidSoFar + applied), balance, change: round2(Math.max(0, dto.amount - applied)) };
  }

  private async releaseTableIfIdle(order: Order) {
    if (!order.tableId) return;
    const active = await this.orders.count({
      where: { tableId: order.tableId, status: In([OrderStatus.OPEN, OrderStatus.SENT, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.SERVED]) },
    });
    if (active === 0) await this.tables.update(order.tableId, { status: TableStatus.FREE });
  }
}
