import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(VerifiedSessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get()
  inbox(@Req() request: AuthenticatedRequest, @Query('page') page?: string) { return this.notifications.inbox(request.user!.userId, page); }
}
