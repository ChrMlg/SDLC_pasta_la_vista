# H10 — Registro de reservación de mesa por el cliente

Fecha: 2026-11-10, America/El_Salvador.

Estado: backend verificado localmente y listo para commit. Publicación, revisión por otro integrante y merge pendientes.

Rama: `feature/H10-table-reservations`. Base: `develop`, commit `ab41cc3`.

Se retomaron los cambios de H10 que estaban sin commit en `develop` y se conservaron al cambiar a la rama existente de la historia. Se omitió la fase 1. El alcance general ahora incluye todos los módulos solicitados, pero esta entrega se detiene en H10; las siguientes historias tendrán su propia rama y PR.

## Qué incluye y por qué

| Rutas | Cambio y razón |
| --- | --- |
| `backend/src/reservations/dto/reservation.dto.ts` | Validar sucursal, fecha, hora y cantidad; rechazar identidad o estado enviados por el cliente. |
| `backend/src/reservations/reservation-rules.ts` | Aplicar duración de 90 minutos, bloques horarios y detección de traslapes. |
| `backend/src/reservations/reservations.controller.ts` | Exponer creación y disponibilidad mediante la sesión existente. |
| `backend/src/reservations/reservations.service.ts` | Asignar una mesa con capacidad suficiente, impedir doble reserva concurrente y notificar después del commit de base de datos. |
| `backend/src/reservations/reservations.module.ts`, `backend/src/main.ts` | Integrar H10 en el mismo backend que los módulos existentes. |
| `backend/src/common/business-error.ts`, `backend/src/common/local-time.ts`, `backend/src/common/menu-error.filter.ts` | Mantener errores uniformes y fechas en la zona horaria del restaurante. |
| `backend/src/notifications/notifications.module.ts` | Verificar al propietario de la reservación al crear su notificación con el servicio existente. |
| `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261109000000_h10_table_reservations/migration.sql` | Persistir reservaciones, horarios y capacidades sin eliminar datos existentes. |
| `backend/prisma/seed.cjs` | Preparar mesas por sucursal de forma repetible, conservando capacidades y estados ya configurados. |
| `backend/package.json`, `backend/scripts/run-qa.cjs`, `backend/scripts/seed-h10-qa.cjs` | Ejecutar pruebas y preparar datos aislados en PostgreSQL local. |
| `backend/test/h10-rules.test.cjs`, `backend/test/h10-integration.test.cjs` | Comprobar reglas, permisos, concurrencia, persistencia y notificaciones. |
| `postman/H10-Reservations.postman_collection.json`, `postman/H10-Local.postman_environment.json` | Entregar solicitudes importables con valores de ejemplo sin secretos. |
| `backend/README.md`, `docs/qa/H10_RESULTS.txt`, `docs/qa/H10_ENTREGA.md` | Documentar operación, evidencia y entrega por historia. |

Además se retiró la carpeta **vacía y no versionada** `backend/prisma/migrations/20261108020000_inventory_reservations_reviews`, que impedía ejecutar Prisma con el error P3015. No se eliminó ningún archivo SQL.

## Endpoints

- `POST /api/reservations`: CUSTOMER; confirma una reserva o devuelve 400/401/403/404/409 según el caso.
- `GET /api/branches/:branchId/reservation-availability?date=YYYY-MM-DD&partySize=2`: CUSTOMER; consulta horarios disponibles sin exponer datos personales.

## Verificación real del 10 de noviembre

- Prisma generate y validate: correctos.
- Prisma migrate deploy: 12 migraciones locales detectadas; ninguna pendiente en la base de pruebas existente.
- `npm run build --workspace backend`: correcto.
- `npm test --workspace backend`: 5 archivos de pruebas aprobados.
- `node backend/scripts/run-qa.cjs npm run test:h10 --workspace backend`: 29 pruebas aprobadas, 0 fallidas (24 escenarios, 4 pruebas de reglas y el test padre).
- `node backend/scripts/run-qa.cjs npm run test:integration --workspace backend`: 108 comprobaciones HTTP/concurrencia aprobadas.
- `git diff --check`: sin errores.

Entorno: PostgreSQL 16 local, base `sdlc_h10_test`, puerto 55440. Se comprobaron la autenticación existente y las notificaciones de reservación. No se ejecutaron migraciones ni seeds en Supabase. Newman no está instalado en esta sesión: se ejecutaron las pruebas HTTP equivalentes; el reporte del 9 de noviembre se conserva identificado como evidencia anterior.

Antes de desplegar en la base compartida, aplicar la migración revisada, configurar capacidades de mesas y confirmar horarios reales. El horario 12:00–22:00 es un valor predeterminado de implementación; H10 no fija horas concretas. H11/H12 y la interfaz de usuario no forman parte de este commit.

## Commit y publicación manual

Ejecutar desde la raíz del repositorio. La rama ya está seleccionada. El cambio previo de `.gitignore` queda fuera de esta entrega porque no implementa H10.

```bash
git branch --show-current
git add backend/package.json backend/README.md \
  backend/prisma/schema.prisma backend/prisma/seed.cjs \
  backend/prisma/migrations/20261109000000_h10_table_reservations/migration.sql \
  backend/scripts/run-qa.cjs backend/scripts/seed-h10-qa.cjs \
  backend/src/common/business-error.ts backend/src/common/local-time.ts \
  backend/src/common/menu-error.filter.ts backend/src/main.ts \
  backend/src/notifications/notifications.module.ts backend/src/reservations \
  backend/test/h10-rules.test.cjs backend/test/h10-integration.test.cjs \
  postman/H10-Reservations.postman_collection.json \
  postman/H10-Local.postman_environment.json \
  docs/qa/H10_RESULTS.txt docs/qa/H10_ENTREGA.md
git diff --cached --stat
git commit -m "feat(H10): registrar reservaciones de mesa (#41)" \
  -m "Permite reservar por sucursal con capacidad suficiente y evita traslapes mediante una transaccion. Obtiene el cliente de la sesion e integra la confirmacion con notificaciones. Incluye migracion, pruebas y coleccion Postman."
git push -u origin feature/H10-table-reservations
```

Razón del commit: permitir que el cliente asegure una mesa y evitar sobrecupo incluso cuando dos solicitudes compiten por la última disponible.

## PR y tablero

Crear el PR desde `feature/H10-table-reservations` hacia `develop`, con título `feat(H10): registrar reservaciones de mesa (#41)`.

Descripción propuesta:

> H10 permite al cliente reservar una mesa durante 90 minutos según la capacidad y el horario de la sucursal. La asignación transaccional evita reservas que se traslapan; dos solicitudes para la última mesa reciben 201 y 409. El cliente se obtiene de la sesión y se utiliza el servicio existente para confirmar la reserva.
>
> Incluye migración, datos de prueba y colección Postman. Validación local: build correcto, 5 suites existentes, 29 pruebas H10 y 108 comprobaciones HTTP aprobadas. Supabase queda pendiente de despliegue. Relacionado con #41.

Verificar que el ticket corresponda a H10 y esté asignado al integrante evaluado, añadir el enlace del PR a su card y solicitar aprobación de otro integrante. Fusionar en `develop` después de la aprobación y antes del cierre de la cátedra. No se han ejecutado commit, push, creación de PR ni merge en esta entrega.

Pausa al terminar H10. La siguiente historia se retoma después de que el usuario indique continuar.
