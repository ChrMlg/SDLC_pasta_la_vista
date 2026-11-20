import { KitchenTicketStatus } from '@prisma/client';
import { BusinessError } from '../../common/business-error';

export function kitchenStatuses(query: Record<string, unknown>): KitchenTicketStatus[] {
  if (Object.keys(query).some(key => key !== 'status'))
    throw new BusinessError(422, 'INVALID_FIELD', 'Filtro no permitido', 'status');
  const value = query.status ?? 'PENDING,IN_PREPARATION';
  if (typeof value !== 'string') throw new BusinessError(422, 'INVALID_FIELD', 'Estado inválido', 'status');
  const statuses = value.split(',');
  if (statuses.some(status => !Object.values(KitchenTicketStatus).includes(status as KitchenTicketStatus)))
    throw new BusinessError(422, 'INVALID_FIELD', 'Estado inválido', 'status');
  return [...new Set(statuses)] as KitchenTicketStatus[];
}
