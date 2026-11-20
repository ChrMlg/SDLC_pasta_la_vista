# API

Swagger local: `http://127.0.0.1:3000/api/docs`. URL HTTPS de Swagger: pendiente de despliegue.

## Autenticación

`POST /api/auth/login` recibe email y password; responde con una cookie HttpOnly `bistro_session`. Enviar la cookie en las llamadas siguientes; Postman la conserva automáticamente. No se usa Bearer JWT. `POST /api/auth/logout` invalida la sesión. Los guards verifican rol y sucursal en el servidor.

## Endpoints por módulo

### analytics — analytics.controller

| Método | Ruta |
|---|---|
| GET | `/api/analytics/sales` |
| GET | `/api/analytics/branches/compare` |
| GET | `/api/analytics/branches/:branchId/top-dishes` |
| GET | `/api/analytics/branches/peak-hours` |
| GET | `/api/analytics/branches/performance` |

### auth — auth.controller

| Método | Ruta |
|---|---|
| POST | `/api/auth/register/customer` |
| POST | `/api/auth/login` |
| GET | `/api/auth/me` |
| POST | `/api/auth/logout` |

### inventory — inventory-movements.controller

| Método | Ruta |
|---|---|
| POST | `/api/management/inventory/movements/` |

### inventory — inventory.controller

| Método | Ruta |
|---|---|
| GET | `/api/management/branches/:branchId/inventory/alerts` |
| GET | `/api/management/branches/:branchId/inventory/` |

### kitchen — kitchen.controller

| Método | Ruta |
|---|---|
| PATCH | `/api/branches/:branchId/kitchen/orders/:orderId/items/:itemId/ready` |
| PATCH | `/api/branches/:branchId/kitchen/orders/:orderId/take` |
| PATCH | `/api/branches/:branchId/kitchen/orders/:orderId/release` |
| GET | `/api/branches/:branchId/kitchen/orders/` |

### menu — menu.controller

| Método | Ruta |
|---|---|
| POST | `/api/branches/:branchId/menu-items` |
| PATCH | `/api/branches/:branchId/menu-items/:menuItemId` |
| GET | `/api/branches/:branchId/menu-items/:menuItemId` |
| GET | `/api/branches/:branchId/menu-items` |
| PATCH | `/api/branches/:branchId/menu-items/:menuItemId/availability` |
| GET | `/api/branches/:branchId/menu` |

### notifications — notifications.controller

| Método | Ruta |
|---|---|
| GET | `/api/notifications/` |

### notifications — order-notifications.controller

| Método | Ruta |
|---|---|
| GET | `/api/branches/:branchId/orders` |

### orders — order-delivery.controller

| Método | Ruta |
|---|---|
| PATCH | `/api/branches/:branchId/orders/:orderId/pickup` |
| PATCH | `/api/branches/:branchId/orders/:orderId/deliver` |

### orders — order-tracking.controller

| Método | Ruta |
|---|---|
| GET | `/api/orders/` |
| PATCH | `/api/orders/:orderId/status/:status` |

### orders — orders.controller

| Método | Ruta |
|---|---|
| POST | `/api/orders/` |
| POST | `/api/orders/customer` |
| POST | `/api/orders/:orderId/link-code` |
| GET | `/api/orders/link-code/:code` |
| POST | `/api/orders/link-code/confirm` |

### orders — seating.controller

| Método | Ruta |
|---|---|
| GET | `/api/branches/` |
| GET | `/api/branches/:branchId/tables` |
| POST | `/api/branches/:branchId/tables/:tableId/select` |
| DELETE | `/api/branches/:branchId/tables/:tableId/select` |

### reservations — customer-reservations.controller

| Método | Ruta |
|---|---|
| GET | `/api/me/reservations/` |
| PUT | `/api/me/reservations/:id/cancel` |

### reviews — branch-reviews.controller

| Método | Ruta |
|---|---|
| GET | `/api/branches/:branchId/reviews/` |

### reviews — ratings-summary.controller

| Método | Ruta |
|---|---|
| GET | `/api/management/branches/:branchId/ratings/summary` |

### reviews — reviews.controller

| Método | Ruta |
|---|---|
| GET | `/api/orders/:orderId/review-eligibility` |
| POST | `/api/orders/:orderId/reviews` |


### billing — cierre, pago simulado y comprobantes H16–H18

| Método | Ruta |
|---|---|
| GET | `/api/branches/:branchId/tables/:tableId/billing-summary` |
| POST | `/api/branches/:branchId/bills` |
| GET | `/api/bills/:billId` |
| POST | `/api/bills/:billId/payments` (cabecera `Idempotency-Key`) |
| GET | `/api/branches/:branchId/receipts/:receiptId` |
| GET | `/api/branches/:branchId/receipts/:receiptId/pdf` |
| GET | `/api/me/receipts` |
| GET | `/api/me/receipts/:receiptId` |
| GET | `/api/me/receipts/:receiptId/pdf` |

### reservations — creación y administración H10–H11

| Método | Ruta |
|---|---|
| POST | `/api/reservations` |
| GET | `/api/branches/:branchId/reservation-availability` |
| GET | `/api/management/branches/:branchId/occupancy` |
| PUT | `/api/reservations/:id/cancel` |

### loyalty — H19–H22

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/me/loyalty/balance` | Cliente propio |
| GET | `/api/me/loyalty/history?page=1` | Cliente propio |
| GET | `/api/loyalty/benefits` | Cliente, beneficios activos |
| POST | `/api/loyalty/redeem` | Cliente; `billId`, `benefitId` |
| DELETE | `/api/loyalty/redeem/:redemptionId` | Cliente, canje propio pendiente |
| GET | `/api/management/loyalty/rules` | Gerente y gerente general |
| PUT | `/api/management/loyalty/rules` | Gerente general |
| GET | `/api/management/loyalty/benefits` | Gerente y gerente general |
| POST | `/api/management/loyalty/benefits` | Gerente general |
| PATCH | `/api/management/loyalty/benefits/:benefitId` | Gerente general |

H19 acumula puntos dentro del pago aprobado; no expone una ruta para acreditar puntos manualmente. Swagger publica los cuerpos de reglas, beneficios y canje. La sesión se obtiene con login desde el mismo Swagger; el navegador gestiona la cookie HttpOnly.
