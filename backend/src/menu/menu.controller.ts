import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiBody } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/session';
import { VerifiedSessionGuard } from '../common/session';
import { MenuService } from './menu.service';

@ApiTags('Menú y pedidos')
@Controller('branches/:branchId')
@UseGuards(VerifiedSessionGuard)
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @ApiBody({ schema: {"type": "object", "properties": {"name": {"type": "string"}, "description": {"type": "string"}, "category": {"type": "string"}, "price": {"type": "string"}}, "example": {"name": "a1111111-1111-4111-8111-111111111111", "description": "Platillo registrado desde Postman", "category": "MAIN_COURSE", "price": "10.00"}} })
  @Post('menu-items')
  create(@Param('branchId') branchId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.menu.create(branchId, req.user!, body);
  }
  @ApiBody({ schema: {"type": "object", "properties": {"description": {"type": "string"}}, "example": {"description": "Pasta con salsa de tomate"}} })
  @Patch('menu-items/:menuItemId')
  update(@Param('branchId') branchId: string, @Param('menuItemId') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.menu.update(branchId, id, req.user!, body);
  }
  @Get('menu-items/:menuItemId')
  get(@Param('branchId') branchId: string, @Param('menuItemId') id: string, @Req() req: AuthenticatedRequest) {
    return this.menu.get(branchId, id, req.user!);
  }
  @ApiQuery({"name": "search", "required": false, "schema": {"type": "string"}})
  @Get('menu-items')
  list(@Param('branchId') branchId: string, @Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.menu.list(branchId, req.user!, query, true);
  }
  @ApiBody({ schema: {"type": "object", "properties": {"isAvailable": {"type": "boolean"}}, "example": {"isAvailable": false}} })
  @Patch('menu-items/:menuItemId/availability')
  availability(@Param('branchId') branchId: string, @Param('menuItemId') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.menu.availability(branchId, id, req.user!, body);
  }
  @ApiQuery({"name": "search", "required": false, "schema": {"type": "string"}})
  @Get('menu')
  publicMenu(@Param('branchId') branchId: string, @Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.menu.list(branchId, req.user!, query, false);
  }
}
