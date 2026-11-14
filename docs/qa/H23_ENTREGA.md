# H23 — Registro de reseñas y calificaciones

Historia: [#54](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/54). Fecha: 2026-11-13.
Rama: `feature/H23-registro-resenas`. Base: H15 (`1857217`), conservando el trabajo pendiente de revisión y la configuración local. Sin merge hacia develop y sin archivos README.

## Alcance y contrato

Se implementa el backend de la issue vigente y las reglas de H23 de las instrucciones del proyecto. Se conserva NestJS, Prisma, PostgreSQL local y la arquitectura del backend compartido.

- `GET /api/orders/:orderId/review-eligibility`: CUSTOMER autenticado; devuelve `{ orderId, branchId, status, deliveredAt, canReview, reason }`. Para pedidos propios no elegibles devuelve 200 con `canReview: false` y motivo legible; si es elegible, `reason: null`.
- `POST /api/orders/:orderId/reviews`: body `{ rating, comment? }`; devuelve 201 con `{ id, orderId, clientId, branchId, rating, comment, createdAt }`.
- Sin sesión: 401. Roles distintos de CUSTOMER: 403. Pedido inexistente o de otro cliente: 404. Pedido sin cliente confirmado: 409 `ORDER_NOT_LINKED` sin exponer sus detalles, en ambos endpoints.
- El registro exige DELIVERED y una fecha de entrega válida, no futura, con `now <= deliveredAt + 720 horas`. El límite se calcula en UTC e incluye la igualdad exacta. Estado, fecha o plazo inválidos: 409 al registrar.
- Una reseña por pedido: `Review.orderId` único. Un duplicado devuelve 409 con el mensaje «Este pedido ya tiene una reseña».
- Rating entero entre 1 y 5. Comentario opcional, nulo o texto de hasta 500 unidades UTF-16; se conserva el texto recibido. Campos adicionales y valores inválidos: 400 con `{ code, message, field }`.
- El cliente se obtiene de la sesión y la sucursal del pedido; no se aceptan identidades o fechas en el body.
- El registro bloquea la fila de Order, reevalúa propiedad/estado/plazo/reseña y crea Review en la misma transacción. El índice único protege también frente a escrituras fuera del servicio.
- No hay edición ni eliminación de reseñas. H24 y H25 todavía no se implementan.

## Integración y datos

Migración aditiva `20261113010000_h23_order_reviews`: tabla Review, claves foráneas a Order/User/Branch, índice único por pedido, índice por sucursal/fecha y restricción de rating. No modifica migraciones anteriores ni datos existentes.

Se reutiliza `Order.clientId` confirmado por el flujo existente. Autoservicio ya vincula al cliente al crear el pedido. Los pedidos del mesero utilizan el código y confirmación de M2; H23 no implementa otra vinculación.

Cocina H6–H9 todavía está pendiente. Las pruebas marcan como DELIVERED únicamente pedidos temporales creados por la propia suite para verificar H23. No se alteran pedidos reales. El recorrido completo de producción M2 → Cocina → H23 queda pendiente de implementar Cocina.

## Ejecución y validación

Con Docker iniciado, desde la raíz:

```bash
npm start
npm run prisma:generate --workspace backend
npm run build --workspace backend
node backend/scripts/run-qa.cjs npm run test:h23 --workspace backend
H23_API_URL=http://127.0.0.1:3000/api node backend/scripts/run-qa.cjs npm run test:h23 --workspace backend
```

Se usa la misma configuración `.env.compose.local` y el volumen persistente. Las suites conservan la protección de base local con nombre terminado en `_test`, que cumple la instalación existente. No crean otra base.

H23 tiene 20 escenarios HTTP/transaccionales, una prueba contenedora y tres pruebas de reglas temporales: 24 pruebas en total. Incluyen 720 horas exactas y +1 ms, permisos, identidad, fechas, límites, concurrencia, rollback, restricciones SQL, ausencia de edición/borrado, autoservicio y vinculación por código. Las pruebas crean fixtures únicos y eliminan solo sus registros al terminar. Se compara una huella de datos del proyecto, pedidos, reseñas, movimientos y alertas antes y después.

Resultados reales de Docker, H23 y regresiones H10–H15 en `H23_RESULTS.txt`. Postman incluye 33 solicitudes y 33 scripts validados sintácticamente; no ejecutado con Postman/Newman. La validación HTTP se ejecutó con la suite automatizada.

`postman/H23-Local.postman_environment.json` es una plantilla sin secretos. Completar cuentas y pedidos propios de prueba o duplicar el entorno privado existente y agregar las variables de pedidos. `orderId` debe ser un pedido entregado, vinculado al cliente, vigente y todavía sin reseña. El registro de la colección se ejecuta una sola vez por pedido. La colección no cambia estados para simular Cocina; no incluye credenciales ni pedidos reales preseleccionados.

## Commit y PR

Commit y push autorizados por el responsable. Título:

```text
feat(H23): registrar resenas de pedidos entregados (#54)
```

Razón del commit:

```text
Permite consultar elegibilidad y registrar una resena por pedido del cliente. Valida entrega, plazo inclusivo de 720 horas, calificacion y comentario; deriva la autoria de la sesion y evita duplicados concurrentes. Incluye migracion aditiva, pruebas de vinculación y validacion en Docker local, sin modificar pedidos existentes.
```

Base del PR: `develop`. Compare: `feature/H23-registro-resenas`. Reviewer: `ChrMlg`. Assignee: `Marceloereyes`.

La rama acumula H14/H15 porque aún no están integradas. H23 no depende funcionalmente del inventario, pero parte de esa revisión para conservar el backend y su configuración actual. Mantener el PR en borrador hasta integrar H14 y H15; entonces revisar el diff contra develop. Si se usa squash o cambian esas historias durante la revisión, ajustar la base antes de integrar H23. No se hace merge automático.

Descripción para copiar:

```text
Relacionado con #54 — H23.
Rama basada en H15; integrar H14 y H15 antes de fusionar este PR.

Agrega consulta de elegibilidad y registro de reseñas para pedidos del cliente
entregados dentro de 720 horas, incluyendo el instante exacto del vencimiento.
Valida calificación y comentario y obtiene autor y sucursal desde el servidor.

La transacción bloquea el pedido y revalida las condiciones; el índice único
impide dos reseñas para el mismo pedido. Incluye migración aditiva y pruebas
de permisos, concurrencia, rollback y vinculación con los pedidos existentes.

Validación: 24 pruebas H23 en local y Docker; regresiones H10–H15,
25 pruebas unitarias y 108 comprobaciones HTTP existentes aprobadas.
Postman preparado; no ejecutado con Postman/Newman.

Cocina sigue pendiente: sus estados finales se simularon exclusivamente
sobre pedidos temporales de prueba. No se modificaron pedidos reales.
Pendiente de revisión y aprobación por Christian.
```

Vincular #54 en Development, copiar el enlace del PR a la historia/card y mantener In progress/en revisión. Marcar los criterios backend comprobados, dejando aprobación y merge pendientes. La issue tiene milestone de la épica 8 y no mostraba Project asociado al revisarla; agregarla al tablero si falta. Después de H23 quedan 11 historias del reparto de cinco módulos; la siguiente es H24.
