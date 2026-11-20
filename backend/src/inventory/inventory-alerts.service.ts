import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';

@Injectable()
export class InventoryAlertsService {
  constructor(private readonly db: PrismaClient) {}

  async list(branchId: string, query: unknown, session: Session) {
    if (session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede consultar las alertas de inventario');
    validateId(branchId, 'branchId');
    branchId = branchId.toLowerCase();
    if (session.role === 'MANAGER' && session.branchId !== branchId)
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    inputFields(query, []);
    const branch = await this.db.branch.findUnique({
      where: { id: branchId },
      select: { inventoryAlerts: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true, branchId: true, itemId: true, currentStock: true, minStock: true,
          status: true, createdAt: true, resolvedAt: true, resolvedByUserId: true,
          // La alerta conserva la medición de origen; el insumo aporta la existencia actual.
          item: { select: { name: true, unit: true, currentStock: true, minStock: true } },
          branch: { select: { name: true } },
        },
      } },
    });
    if (!branch) throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    return branch.inventoryAlerts;
  }
}
