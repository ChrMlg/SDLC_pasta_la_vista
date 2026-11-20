export const REVIEW_WINDOW_MS = 720 * 60 * 60 * 1000;

export function reviewConflict(order: { status: string; deliveredAt: Date | null; review: { id: string } | null }, now: Date) {
  if (order.review) return { code: 'REVIEW_ALREADY_EXISTS', message: 'Este pedido ya tiene una reseña' };
  if (order.status !== 'DELIVERED') return { code: 'ORDER_NOT_DELIVERED', message: 'El pedido aún no está entregado' };
  const deliveredAt = order.deliveredAt?.getTime();
  if (deliveredAt === undefined || !Number.isFinite(deliveredAt) || deliveredAt > now.getTime())
    return { code: 'INVALID_DELIVERY_DATE', message: 'El pedido no tiene una fecha de entrega válida' };
  if (now.getTime() > deliveredAt + REVIEW_WINDOW_MS)
    return { code: 'REVIEW_WINDOW_EXPIRED', message: 'El plazo de 720 horas para reseñar este pedido venció' };
  return null;
}
