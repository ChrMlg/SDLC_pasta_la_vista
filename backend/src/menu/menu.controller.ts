import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/session';
import { VerifiedSessionGuard } from '../common/session';
import { MenuService } from './menu.service';

@Controller('branches/:branchId')
@UseGuards(VerifiedSessionGuard)
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Post('menu-items')
  create(@Param('branchId') branchId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.menu.create(branchId, req.user!, body);
  }
  @Patch('menu-items/:menuItemId')
  update(@Param('branchId') branchId: string, @Param('menuItemId') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.menu.update(branchId, id, req.user!, body);
  }
  @Get('menu-items/:menuItemId')
  get(@Param('branchId') branchId: string, @Param('menuItemId') id: string, @Req() req: AuthenticatedRequest) {
    return this.menu.get(branchId, id, req.user!);
  }
  @Get('menu-items')
  list(@Param('branchId') branchId: string, @Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.menu.list(branchId, req.user!, query, true);
  }
  @Patch('menu-items/:menuItemId/availability')
  availability(@Param('branchId') branchId: string, @Param('menuItemId') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.menu.availability(branchId, id, req.user!, body);
  }
  @Get('menu')
  publicMenu(@Param('branchId') branchId: string, @Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.menu.list(branchId, req.user!, query, false);
  }
}
