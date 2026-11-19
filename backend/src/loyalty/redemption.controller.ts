import { Body, CanActivate, Controller, Delete, ExecutionContext, Injectable, Param, Post, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '../common/business-error';
import type { AuthenticatedRequest } from '../common/session';
import { RedemptionService } from './redemption.service';

@Injectable()
export class RedemptionGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user?.userId) throw new BusinessError(401, 'UNAUTHORIZED', 'Sesión requerida');
    if (user.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo clientes pueden canjear puntos');
    return true;
  }
}

@Controller('loyalty/redeem')
@UseGuards(RedemptionGuard)
export class RedemptionController {
  constructor(private readonly redemptions: RedemptionService) {}

  @Post()
  redeem(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.redemptions.redeem(body, request.user!);
  }

  @Delete(':redemptionId')
  release(@Param('redemptionId') id: string, @Req() request: AuthenticatedRequest) {
    return this.redemptions.release(id, request.user!);
  }
}
