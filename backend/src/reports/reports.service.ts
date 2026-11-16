import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BranchesService } from '../branches/branches.service';
import { AuthUser } from '../common/auth';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';

export interface Range { from: Date; to: Date; branchId?: string }
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private branches: BranchesService,
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(Payment) private payments: Repository<Payment>,
  ) {}

  /** WHERE fragment limiting rows to the user's organization/branch and the date range. Alias `a` must join `branches b`. */
  private scope(user: AuthUser, r: Range, a = 'o') {
    const params: any[] = [user.orgId, r.from, r.to];
    let sql = `b."organizationId" = $1 AND ${a}."createdAt" >= $2 AND ${a}."createdAt" < $3`;
    const branchId = user.branchId ?? r.branchId; // branch-level users are always pinned to their branch
    if (branchId) { params.push(branchId); sql += ` AND ${a}."branchId" = $${params.length}`; }
    return { sql, params, branchId };
  }

  private async kpis(user: AuthUser, r: Range) {
    const s = this.scope(user, r);
    const [row] = await this.ds.query(
      `SELECT
         COALESCE(SUM(o.total)    FILTER (WHERE o.status = 'PAID'), 0)::float AS sales,
         COUNT(*)                 FILTER (WHERE o.status = 'PAID')::int       AS orders,
         COALESCE(SUM(o.tax)      FILTER (WHERE o.status = 'PAID'), 0)::float AS tax,
         COALESCE(SUM(o.discount) FILTER (WHERE o.status = 'PAID'), 0)::float AS discounts,
         COUNT(*)                 FILTER (WHERE o.status = 'CANCELLED')::int  AS "cancelledOrders",
         COALESCE(SUM(o.total)    FILTER (WHERE o.status = 'CANCELLED'), 0)::float AS "cancelledValue"
       FROM orders o JOIN branches b ON b.id = o."branchId" WHERE ${s.sql}`,
      s.params,
    );
    const [items] = await this.ds.query(
      `SELECT COALESCE(SUM(oi.quantity), 0)::int AS "itemsSold"
       FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN branches b ON b.id = o."branchId"
       WHERE ${s.sql} AND o.status = 'PAID'`,
      s.params,
    );
    return { ...row, itemsSold: items.itemsSold, avgOrder: row.orders ? round2(row.sales / row.orders) : 0 };
  }

  async summary(user: AuthUser, r: Range, tz: string) {
    const ms = r.to.getTime() - r.from.getTime();
    const granularity: 'hour' | 'day' = ms <= 48 * 3600 * 1000 ? 'hour' : 'day';
    const prev: Range = { from: new Date(r.from.getTime() - ms), to: r.from, branchId: r.branchId };

    const s = this.scope(user, r);
    const withTz = { sql: s.sql, params: [...s.params, tz] };
    const tzIdx = withTz.params.length;
    const paid = `AND o.status = 'PAID'`;
    const from = `FROM orders o JOIN branches b ON b.id = o."branchId"`;

    // "live" = what is happening right now (not limited to the date range)
    const liveParams: any[] = [user.orgId];
    let liveBranch = '';
    const liveBranchId = user.branchId ?? r.branchId;
    if (liveBranchId) { liveParams.push(liveBranchId); liveBranch = ` AND o."branchId" = $2`; }

    const ps = this.scope(user, r, 'p');

    const [kpis, previous, series, hourly, topItems, byCategory, byType, byPayment, byBranch, byStaff, liveStatus, liveTables] = await Promise.all([
      this.kpis(user, r),
      this.kpis(user, prev),
      this.ds.query(
        `SELECT to_char(date_trunc('${granularity}', o."createdAt" AT TIME ZONE $${tzIdx}::text), 'YYYY-MM-DD"T"HH24:MI') AS bucket,
                COALESCE(SUM(o.total), 0)::float AS sales, COUNT(*)::int AS orders
         ${from} WHERE ${withTz.sql} ${paid} GROUP BY 1 ORDER BY 1`, withTz.params),
      this.ds.query(
        `SELECT EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE $${tzIdx}::text)::int AS hour,
                COALESCE(SUM(o.total), 0)::float AS sales, COUNT(*)::int AS orders
         ${from} WHERE ${withTz.sql} ${paid} GROUP BY 1 ORDER BY 1`, withTz.params),
      this.ds.query(
        `SELECT oi.name, SUM(oi.quantity)::int AS qty, COALESCE(SUM(oi."lineTotal"), 0)::float AS revenue
         FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN branches b ON b.id = o."branchId"
         WHERE ${s.sql} ${paid} GROUP BY oi."menuItemId", oi.name ORDER BY revenue DESC LIMIT 10`, s.params),
      this.ds.query(
        `SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(SUM(oi."lineTotal"), 0)::float AS revenue, SUM(oi.quantity)::int AS qty
         FROM order_items oi JOIN orders o ON o.id = oi."orderId" JOIN branches b ON b.id = o."branchId"
         LEFT JOIN menu_items mi ON mi.id = oi."menuItemId" LEFT JOIN categories c ON c.id = mi."categoryId"
         WHERE ${s.sql} ${paid} GROUP BY 1 ORDER BY revenue DESC`, s.params),
      this.ds.query(
        `SELECT o.type, COUNT(*)::int AS orders, COALESCE(SUM(o.total), 0)::float AS sales
         ${from} WHERE ${s.sql} ${paid} GROUP BY o.type ORDER BY sales DESC`, s.params),
      this.ds.query(
        `SELECT p.method, COALESCE(SUM(p.amount), 0)::float AS amount, COUNT(*)::int AS count
         FROM payments p JOIN branches b ON b.id = p."branchId" WHERE ${ps.sql} GROUP BY p.method ORDER BY amount DESC`, ps.params),
      this.ds.query(
        `SELECT b.id AS "branchId", b.name, COUNT(*)::int AS orders, COALESCE(SUM(o.total), 0)::float AS sales
         ${from} WHERE ${s.sql} ${paid} GROUP BY b.id, b.name ORDER BY sales DESC`, s.params),
      this.ds.query(
        `SELECT u.id AS "userId", u.name, u.role, COUNT(*)::int AS orders, COALESCE(SUM(o.total), 0)::float AS sales
         ${from} JOIN users u ON u.id = o."createdById"
         WHERE ${s.sql} ${paid} GROUP BY u.id, u.name, u.role ORDER BY sales DESC`, s.params),
      this.ds.query(
        `SELECT o.status, COUNT(*)::int AS count, COALESCE(SUM(o.total), 0)::float AS value
         ${from} WHERE b."organizationId" = $1${liveBranch} AND o.status IN ('OPEN','SENT','PREPARING','READY','SERVED')
         GROUP BY o.status`, liveParams),
      this.ds.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE t.status = 'OCCUPIED')::int AS occupied
         FROM dining_tables t JOIN branches b ON b.id = t."branchId"
         WHERE b."organizationId" = $1${liveBranch.replace('o."branchId"', 't."branchId"')}`, liveParams),
    ]);

    return {
      range: { from: r.from, to: r.to },
      granularity,
      kpis, previous, series, hourly, topItems, byCategory, byType, byPayment, byBranch, byStaff,
      live: { byStatus: liveStatus, tables: liveTables[0] ?? { total: 0, occupied: 0 } },
    };
  }

  async orderHistory(
    user: AuthUser,
    q: { from: Date; to: Date; branchId?: string; status?: string; search?: string; limit: number; offset: number },
  ) {
    const s = this.scope(user, q);
    const params = [...s.params];
    let extra = '';
    if (q.status) { params.push(q.status); extra += ` AND o.status = $${params.length}`; }
    if (q.search) { params.push(`%${q.search}%`); extra += ` AND o."orderNumber" ILIKE $${params.length}`; }
    const base = `FROM orders o JOIN branches b ON b.id = o."branchId"
                  LEFT JOIN users u ON u.id = o."createdById" LEFT JOIN dining_tables t ON t.id = o."tableId"
                  WHERE ${s.sql}${extra}`;
    const [{ count }] = await this.ds.query(`SELECT COUNT(*)::int AS count ${base}`, params);
    const rows = await this.ds.query(
      `SELECT o.id, o."orderNumber", o.status, o.type, o.subtotal::float, o.tax::float, o.discount::float, o.total::float,
              o."createdAt", o."branchId", b.name AS branch, u.name AS staff, t.label AS "tableLabel"
       ${base} ORDER BY o."createdAt" DESC LIMIT ${q.limit} OFFSET ${q.offset}`,
      params,
    );
    return { total: count, rows };
  }

  async orderDetail(user: AuthUser, id: string) {
    const order = await this.orders.findOne({ where: { id }, relations: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    await this.branches.getForUser(user, order.branchId); // org + branch access check
    const payments = await this.payments.find({ where: { orderId: id }, order: { createdAt: 'ASC' } });
    const [meta] = await this.ds.query(
      `SELECT u.name AS staff, t.label AS "tableLabel"
       FROM orders o LEFT JOIN users u ON u.id = o."createdById" LEFT JOIN dining_tables t ON t.id = o."tableId" WHERE o.id = $1`,
      [id],
    );
    return { order, payments, staff: meta?.staff ?? null, tableLabel: meta?.tableLabel ?? null };
  }
}
