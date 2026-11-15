import { inputFields, invalid } from '../../common/business-error';

export function reviewsQuery(query: Record<string, unknown>) {
  inputFields(query, ['rating', 'page']);
  if (query.rating !== undefined && (typeof query.rating !== 'string' || !/^[1-5]$/.test(query.rating)))
    invalid('rating', 'La calificación debe ser un entero entre 1 y 5');
  if (query.page !== undefined && (typeof query.page !== 'string' || !/^[1-9]\d*$/.test(query.page)))
    invalid('page', 'La página debe ser un entero positivo');
  const page = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * 10)) invalid('page', 'Página fuera de rango');
  return { page, rating: query.rating === undefined ? undefined : Number(query.rating) };
}
