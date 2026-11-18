import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth';
import { OrderStatus, OrderType, PaymentMethod, Role } from '../common/enums';
import { ReportsService } from './reports.service';

const DAY = 24 * 3600 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRange(from?: string, to?: string) {
  const f = new Date(from ?? ''), t = new Date(to ?? '');
  if (isNaN(+f) || isNaN(+t) || t <= f) throw new BadRequestException('Invalid date range');
  if (t.getTime() - f.getTime() > 366 * DAY) throw new BadRequestException('Date range cannot exceed 366 days');
  return { from: f, to: t };
}
function parseTz(tz?: string) {
  if (!tz) return 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.ADMIN)
export class ReportsController {
  constructor(private svc: ReportsService) {}

  @Get('summary')
  summary(
    @CurrentUser() u: AuthUser,
    @Query('from') from?: string, @Query('to') to?: string,
    @Query('branchId') branchId?: string, @Query('tz') tz?: string,
  ) {
    return this.svc.summary(u, { ...parseRange(from, to), branchId: branchId || undefined }, parseTz(tz));
  }

  @Get('items')
  items(
    @CurrentUser() u: AuthUser,
    @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string,
  ) {
    return this.svc.items(u, { ...parseRange(from, to), branchId: branchId || undefined });
  }

  @Get('orders')
  orders(
    @CurrentUser() u: AuthUser,
    @Query() q: Record<string, string | undefined>,
  ) {
    const live = q.live === '1';
    const statuses = q.status ? q.status.split(',').filter(Boolean) : undefined;
    if (statuses?.some((st) => !(st in OrderStatus))) throw new BadRequestException('Invalid status');
    if (q.type && !(q.type in OrderType)) throw new BadRequestException('Invalid type');
    if (q.paymentMethod && !(q.paymentMethod in PaymentMethod)) throw new BadRequestException('Invalid payment method');
    for (const k of ['staffId', 'menuItemId', 'categoryId', 'branchId'] as const) {
      if (q[k] && !UUID.test(q[k]!)) throw new BadRequestException(`Invalid ${k}`);
    }
    const hour = q.hour !== undefined && q.hour !== '' ? parseInt(q.hour, 10) : undefined;
    if (hour !== undefined && !(hour >= 0 && hour <= 23)) throw new BadRequestException('Invalid hour');
    return this.svc.orderHistory(u, {
      ...(live ? {} : parseRange(q.from, q.to)),
      live,
      branchId: q.branchId || undefined,
      status: statuses,
      type: q.type || undefined,
      staffId: q.staffId || undefined,
      hasDiscount: q.hasDiscount === '1',
      hasTax: q.hasTax === '1',
      menuItemId: q.menuItemId || undefined,
      categoryId: q.categoryId || undefined,
      paymentMethod: q.paymentMethod || undefined,
      hour,
      tz: parseTz(q.tz),
      search: q.q?.trim() || undefined,
      limit: Math.min(Math.max(parseInt(q.limit ?? '25', 10) || 25, 1), 100),
      offset: Math.max(parseInt(q.offset ?? '0', 10) || 0, 0),
    });
  }

  @Get('orders/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.orderDetail(u, id);
  }
}
