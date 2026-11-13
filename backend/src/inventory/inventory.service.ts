import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';

@Injectable()
export class InventoryService {
  constructor(private readonly db: PrismaClient) {}

  async list(branchId: string, query: unknown, session: Session) {
    if (session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede consultar el inventario');
    validateId(branchId, 'branchId');
    if (session.role === 'MANAGER' && session.branchId !== branchId)
      throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    inputFields(query, []);
    // Una sola consulta distingue sucursal inexistente de inventario vacío.
    const branch = await this.db.branch.findUnique({
      where: { id: branchId },
      select: { inventoryItems: {
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, branchId: true, name: true, unit: true, minStock: true, currentStock: true },
      } },
    });
    if (!branch) throw new BusinessError(404, 'NOT_FOUND', 'Sucursal no encontrada');
    return branch.inventoryItems;
  }
}
