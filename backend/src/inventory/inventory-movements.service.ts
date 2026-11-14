import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, invalid } from '../common/business-error';
import { validateInventoryMovement } from './dto/inventory-movement.dto';

@Injectable()
export class InventoryMovementsService {
  constructor(private readonly db: PrismaClient) {}

  async create(body: unknown, session: Session) {
    if (session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede registrar movimientos');
    const input = validateInventoryMovement(body);
    if (session.role === 'MANAGER' && session.branchId !== input.branchId)
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    return this.db.$transaction(async tx => {
      // Serializa movimientos del mismo insumo antes de leer sus existencias.
      await tx.$queryRaw`SELECT "id" FROM "InventoryItem"
        WHERE "id" = ${input.itemId}::uuid AND "branchId" = ${input.branchId}::uuid FOR UPDATE`;
      const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, branchId: input.branchId } });
      if (!item) throw new BusinessError(404, 'NOT_FOUND', 'Insumo o sucursal no encontrado');
      const currentStock = item.currentStock + (input.type === 'IN' ? input.quantity : -input.quantity);
      if (currentStock < 0) throw new BusinessError(400, 'INSUFFICIENT_STOCK', 'Stock insuficiente para esta salida', 'quantity');
      if (currentStock > 2147483647) invalid('quantity', 'La entrada supera la capacidad de almacenamiento del insumo');
      await tx.inventoryItem.update({ where: { id: item.id }, data: { currentStock } });
      const movement = await tx.inventoryMovement.create({ data: {
        itemId: item.id, quantity: input.quantity, type: input.type, reason: input.reason, createdById: session.userId,
      } });
      if (currentStock <= item.minStock) {
        // El bloqueo del insumo serializa la comprobación; el índice parcial impide duplicar ACTIVE.
        const active = await tx.inventoryAlert.findFirst({ where: { itemId: item.id, status: 'ACTIVE' }, select: { id: true } });
        if (!active) await tx.inventoryAlert.create({ data: {
          branchId: item.branchId, itemId: item.id, currentStock, minStock: item.minStock,
        } });
      }
      if (input.type === 'IN' && currentStock > item.minStock) {
        await tx.inventoryAlert.updateMany({ where: { itemId: item.id, status: 'ACTIVE' },
          data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByUserId: session.userId } });
      }
      return movement;
    });
  }
}
