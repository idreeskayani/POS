import { OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { AuthUser, jwtSecret } from '../common/auth';
import { ORG_WIDE_ROLES, Role } from '../common/enums';
import { Branch } from '../entities/branch.entity';

const KITCHEN_ROOM_ROLES: Role[] = [Role.KITCHEN, Role.MANAGER, Role.OWNER, Role.ADMIN];

/**
 * Rooms:  branch:{id}          -> everyone working in that branch (order updates, table changes)
 *         branch:{id}:kitchen  -> kitchen display + managers (new tickets)
 * Client connects with  io(url + '/ws', { auth: { token: accessToken } }).
 * Branch-level users are auto-joined; org-wide users send 'join:branch' { branchId }.
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private jwt: JwtService,
    @InjectRepository(Branch) private branches: Repository<Branch>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      const user = await this.jwt.verifyAsync<AuthUser>(token, { secret: jwtSecret() });
      client.data.user = user;
      if (user.branchId) this.join(client, user.branchId, user.role);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join:branch')
  async joinBranch(@ConnectedSocket() client: Socket, @MessageBody() body: { branchId: string }) {
    const user: AuthUser | undefined = client.data.user;
    if (!user || !ORG_WIDE_ROLES.includes(user.role)) return { ok: false };
    const ok = await this.branches.exist({ where: { id: body?.branchId, organizationId: user.orgId } });
    if (!ok) return { ok: false };
    this.join(client, body.branchId, user.role);
    return { ok: true };
  }

  private join(client: Socket, branchId: string, role: Role) {
    client.join(`branch:${branchId}`);
    if (KITCHEN_ROOM_ROLES.includes(role)) client.join(`branch:${branchId}:kitchen`);
  }

  toBranch(branchId: string, event: string, data: unknown) {
    this.server?.to(`branch:${branchId}`).emit(event, data);
  }
  toKitchen(branchId: string, event: string, data: unknown) {
    this.server?.to(`branch:${branchId}:kitchen`).emit(event, data);
  }
}
