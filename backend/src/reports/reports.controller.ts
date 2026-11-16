import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth';
import { OrderStatus, Role } from '../common/enums';
import { ReportsService } from './reports.service';

const DAY = 24 * 3600 * 1000;

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

  @Get('orders')
  orders(
    @CurrentUser() u: AuthUser,
    @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string,
    @Query('status') status?: string, @Query('q') q?: string,
    @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    if (status && !(status in OrderStatus)) throw new BadRequestException('Invalid status');
    return this.svc.orderHistory(u, {
      ...parseRange(from, to),
      branchId: branchId || undefined,
      status: status || undefined,
      search: q?.trim() || undefined,
      limit: Math.min(Math.max(parseInt(limit ?? '25', 10) || 25, 1), 100),
      offset: Math.max(parseInt(offset ?? '0', 10) || 0, 0),
    });
  }

  @Get('orders/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.orderDetail(u, id);
  }
}
