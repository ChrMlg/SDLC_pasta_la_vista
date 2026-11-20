import { ApiQuery } from '@nestjs/swagger';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { VerifiedSessionGuard, type AuthenticatedRequest } from '../common/session';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(VerifiedSessionGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @ApiQuery({"name": "sourceModule", "required": false, "schema": {"type": "string"}})
  @Get()
  inbox(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) { return this.notifications.inbox(request.user!.userId, query); }
}
