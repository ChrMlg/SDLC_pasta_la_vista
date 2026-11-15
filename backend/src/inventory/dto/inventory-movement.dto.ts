import { inputFields, invalid, validateId } from '../../common/business-error';
import { InventoryMovementType } from '@prisma/client';

export type InventoryMovementDto = {
  branchId: string; itemId: string; quantity: number; type: InventoryMovementType; reason: string;
};

export function validateInventoryMovement(body: unknown): InventoryMovementDto {
  const input = inputFields(body, ['branchId', 'itemId', 'quantity', 'type', 'reason']);
  validateId(input.branchId, 'branchId');
  validateId(input.itemId, 'itemId');
  if (typeof input.quantity !== 'number' || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 2147483647)
    invalid('quantity', 'Ingrese una cantidad entera mayor a cero');
  if (input.type !== InventoryMovementType.IN && input.type !== InventoryMovementType.OUT)
    invalid('type', 'Seleccione IN u OUT');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 200)
    invalid('reason', 'Ingrese un motivo de 1 a 200 caracteres');
  return { branchId: input.branchId.toLowerCase(), itemId: input.itemId.toLowerCase(), quantity: input.quantity,
    type: input.type, reason: input.reason.trim() };
}
