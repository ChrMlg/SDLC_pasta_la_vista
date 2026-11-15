import { inputFields, invalid } from '../../common/business-error';
import { localInstant, validateDate } from '../../common/local-time';

export function ratingsDateRange(query: Record<string, unknown>) {
  inputFields(query, ['dateFrom', 'dateTo']);
  if (query.dateFrom === undefined && query.dateTo === undefined) return undefined;
  if (query.dateFrom === undefined) invalid('dateFrom', 'Debe enviar ambas fechas');
  if (query.dateTo === undefined) invalid('dateTo', 'Debe enviar ambas fechas');
  const from = validateDate(query.dateFrom, 'dateFrom'), to = validateDate(query.dateTo, 'dateTo');
  if (to < from) invalid('dateTo', 'La fecha final debe ser igual o posterior a la inicial');
  // Intervalo semiabierto: incluye todo el día final local, incluso fracciones de segundo.
  return { gte: localInstant(from), lt: new Date(localInstant(to).getTime() + 24 * 60 * 60 * 1000) };
}
