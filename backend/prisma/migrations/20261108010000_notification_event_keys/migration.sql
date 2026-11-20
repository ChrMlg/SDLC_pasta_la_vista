-- Conserva los avisos y evita duplicarlos al reproducir eventos tras actualizar el servicio.
UPDATE "Notification" SET "eventKey" =
  CASE split_part("eventKey", ':', 1)
    WHEN 'ORDER_CREATED' THEN 'order.created:'
    WHEN 'ORDER_QUEUED' THEN 'order.queued:'
    WHEN 'KITCHEN_PENDING' THEN 'order.queued:'
    WHEN 'KITCHEN_IN_PREPARATION' THEN 'order.in_preparation:'
    WHEN 'WAITER_IN_PREPARATION' THEN 'order.in_preparation:'
    WHEN 'KITCHEN_READY' THEN 'order.ready:'
    WHEN 'WAITER_READY' THEN 'order.ready:'
    WHEN 'RESERVATION_CONFIRMED' THEN 'reservation.confirmed:'
    WHEN 'RESERVATION_CANCELLED' THEN 'reservation.cancelled:'
  END || split_part("eventKey", ':', 2)
WHERE split_part("eventKey", ':', 1) IN (
  'ORDER_CREATED', 'ORDER_QUEUED', 'KITCHEN_PENDING', 'KITCHEN_IN_PREPARATION',
  'WAITER_IN_PREPARATION', 'KITCHEN_READY', 'WAITER_READY', 'RESERVATION_CONFIRMED', 'RESERVATION_CANCELLED'
);
