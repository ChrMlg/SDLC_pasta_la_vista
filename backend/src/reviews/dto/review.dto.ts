import { inputFields, invalid } from '../../common/business-error';

export function validateReview(body: unknown) {
  const input = inputFields(body, ['rating', 'comment']);
  if (!Number.isInteger(input.rating) || (input.rating as number) < 1 || (input.rating as number) > 5)
    invalid('rating', 'La calificación debe ser un entero entre 1 y 5');
  if (input.comment !== undefined && input.comment !== null &&
      (typeof input.comment !== 'string' || input.comment.length > 500))
    invalid('comment', 'El comentario debe ser texto de hasta 500 caracteres');
  return { rating: input.rating as number, comment: (input.comment as string | null | undefined) ?? null };
}
