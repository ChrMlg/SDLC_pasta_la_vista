import { BusinessError } from '../../common/business-error';
import type { Session } from '../../menu/menu.service';

export const MAX_REPORT_DAYS = 366;
export function reportInvalid(field: string, message = 'Filtro inválido'): never {
  throw new BusinessError(422, 'INVALID_FIELD', message, field);
}
export function requireGeneral(session: Session) {
  if (session.role !== 'GENERAL_MANAGER') throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia general puede consultar reportes');
}
export function reportFields(query: Record<string, unknown>, extra: string[] = []) {
  for (const key of Object.keys(query)) if (!['from', 'to', ...extra].includes(key)) reportInvalid(key);
}
function instant(value: unknown, field: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) reportInvalid(field, 'Use ISO-8601 con zona horaria');
  const date = value.slice(0,10), day = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date || Number(value.slice(11,13)) > 23 || Number(value.slice(14,16)) > 59 || Number(value.slice(17,19)) > 59) reportInvalid(field, 'Fecha inválida');
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) reportInvalid(field, 'Fecha inválida');
  return result;
}
export function reportPeriod(query: Record<string, unknown>) {
  const from = instant(query.from, 'from'), to = instant(query.to, 'to');
  if (to < from || to.getTime() - from.getTime() > MAX_REPORT_DAYS * 86400000) reportInvalid('to', 'Rango invertido o mayor a 366 días');
  return { from, to };
}
export type ReportPeriod = ReturnType<typeof reportPeriod>;
export const periodResponse = (period: ReportPeriod) => ({ from: period.from.toISOString(), to: period.to.toISOString() });
export function reportBranchIds(value: unknown, minimum: number) {
  if (typeof value !== 'string') reportInvalid('branchIds');
  const ids = value.split(',').map(id => id.toLowerCase());
  if (ids.length < minimum || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) reportInvalid('branchIds', 'Seleccione sucursales distintas y válidas');
  return ids;
}
