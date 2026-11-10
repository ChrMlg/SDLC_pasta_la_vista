# SDLC backend

## H10 - Table reservations

Story: [H10 / issue #41](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/41).
Branch: `feature/H10-table-reservations`, based on `develop`.

H10 implements customer reservation creation and the availability query needed to select a time. H11 adds management occupancy and cancellation as documented below. Customer reservation lists and cancellation belong to H12 and remain pending.

| Method | Route (prefix `/api`) | Access |
| --- | --- | --- |
| POST | `/reservations` | CUSTOMER |
| GET | `/branches/:branchId/reservation-availability?date=YYYY-MM-DD&partySize=2` | CUSTOMER |

```json
{"branchId":"<uuid>","date":"2030-01-15","time":"12:00","partySize":4}
```

Successful creation returns HTTP 201 with `id`, `branchId`, `tableId`, `customerId`, `date`, `startTime`, `endTime`, `partySize`, `status`, timestamps, `branchName`, and `tableNumber`. The customer comes from the verified session cookie. Errors use `{code, message, field}`: 400 for invalid data, 401 for no session, 403 for staff roles, 404 for a missing branch, and 409 when no suitable table is available.

Reservations last 90 minutes. Start times are one hour apart from opening and the full reservation must fit before closing. The implementation default is **12:00-22:00 daily**, configurable through `Branch.openingTime` and `Branch.closingTime`; the last default start is 20:00. H10 does not specify exact business hours, so configure these values for each branch before shared deployment. Dates and times use `America/El_Salvador`. The canonical `date`, `startTime`, and `endTime` fields are stored as local strings, while audit timestamps use UTC.

Creation locks the branch and its eligible tables within one transaction, then checks overlaps using half-open intervals. Two requests for the last table produce one 201 and one 409. PENDING and CONFIRMED reservations block capacity; CANCELLED reservations do not. Tables without a capacity or marked OUT_OF_SERVICE are excluded. The smallest suitable table is selected. Future bookings do not change the table's current operational status.

Availability returns `{branchId, date, partySize, timeZone, slots}`; each slot contains only `{time, endTime, available}`. It does not disclose customers or table IDs. Creation always checks availability again inside the transaction.

After commit, the existing notification service records `reservation.confirmed:<id>` for the customer. A notification failure is logged and does not undo the reservation. Persistent notification retries remain outside this story.

## Migration and seed

`20261109000000_h10_table_reservations` adds only Reservation, branch opening hours, nullable table capacity, indexes, and validation constraints. Existing records are retained. Existing table capacities remain unset until explicitly configured.

The Prisma seed requires three existing branch IDs through `RESERVATION_CENTRO_ID`, `RESERVATION_BAMBU_ID`, and `RESERVATION_RAMBLAS_ID`. It prepares 12/10/8 tables with the documented capacity groups. It fills unset capacities, preserves existing capacities and statuses, and can be repeated without duplicates. Run `prisma db seed --schema backend/prisma/schema.prisma` with those variables only after selecting the intended database. Historical branch names and identities are not replaced automatically.

No migrations or seeds from this story have been applied to Supabase. Local QA uses a separate PostgreSQL database.

## Local verification

Run commands from the repository root. `.env.h10.qa.local` is private and ignored. It contains DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, QA_DB_PORT, QA_API_PORT, and QA_BASE_URL. Use a URL-safe random local password, the database name `sdlc_h10_test`, database port 55440, and API port 3310. `run-qa.cjs` rejects remote databases and names without the `_test` suffix; it sets DIRECT_URL to that same local database. It never reads `backend/.env`.

```bash
docker compose -p sdlc-h10 -f compose.yaml -f compose.test.yaml --env-file .env.h10.qa.local up -d --wait db
node backend/scripts/run-qa.cjs ./node_modules/.bin/prisma generate --schema backend/prisma/schema.prisma
node backend/scripts/run-qa.cjs ./node_modules/.bin/prisma migrate deploy --schema backend/prisma/schema.prisma
npm run build --workspace backend
npm test --workspace backend
node backend/scripts/run-qa.cjs npm run test:h10 --workspace backend
node backend/scripts/run-qa.cjs npm run test:integration --workspace backend
```

The H10 suite starts its own backend on port 3323, creates isolated fixtures, and removes only those fixtures afterward. It covers concurrent requests, access control, validation, notification ownership/failure, database constraints, and repeatable seeding. The notification-failure test deliberately produces an error log; that log is expected.

For the H10 Postman collection:

```bash
node backend/scripts/run-qa.cjs npm run db:seed:h10:qa --workspace backend
PORT=3310 node backend/scripts/run-qa.cjs node backend/dist/main.js
```

In another terminal, import `postman/H10-Reservations.postman_collection.json` and the private `postman/.env.h10.local` into Postman, or run with Newman installed separately:

```bash
newman run postman/H10-Reservations.postman_collection.json -e postman/.env.h10.local
```

The tracked `postman/H10-Local.postman_environment.json` contains placeholders only. Each run creates a reservation; choose another future date/time if repeated runs fill the selected slot. Do not commit private environments or exported session cookies. Execution evidence is in `docs/qa/H10_RESULTS.txt`.

## Review

Use `feat(H10): registrar reservaciones de mesa (#41)` as the commit and PR title. Explain that the change prevents overlapping bookings and derives customer identity from the session. Link issue #41 in the PR and add the PR URL to the board card. Confirm the story is assigned to the responsible contributor. Another team member must approve the PR before it is merged into `develop`. See [H10 delivery instructions](../docs/qa/H10_ENTREGA.md) for the exact staging commands, reason for the commit, and verification performed on 2026-11-10.

## H11 - Ocupación proyectada y cancelación gerencial

Historia: [H11 / issue #42](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/42).
Rama: `feature/H11-ocupacion-cancelacion-reservaciones`, creada desde el commit H10 `c242e5a` porque [PR #68](https://github.com/ChrMlg/SDLC_pasta_la_vista/pull/68) todavía estaba pendiente de merge al iniciar H11.

El código se incorpora al módulo existente `backend/src/reservations`: controlador y servicio gerenciales separados de las rutas de cliente, un DTO para el filtro y la regla de cancelación compartida. No agrega modelos, migraciones, dependencias ni endpoints de H12. Requiere la migración de H10 ya aplicada.

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/management/branches/:branchId/occupancy?date=YYYY-MM-DD` | MANAGER de esa sucursal o GENERAL_MANAGER |
| PUT | `/api/reservations/:id/cancel` | MANAGER de la sucursal de la reserva o GENERAL_MANAGER |

La consulta exige `date`, admite fechas históricas y rechaza filtros adicionales. Devuelve:

```json
{
  "branchId": "<uuid>",
  "date": "2030-01-15",
  "timeZone": "America/El_Salvador",
  "totalTables": 12,
  "slots": [
    { "startTime": "12:00", "endTime": "13:00", "reservedTables": 2, "availableTables": 10, "occupancyPercentage": 16.67 }
  ],
  "reservations": [
    { "id": "<uuid>", "tableId": "<uuid>", "tableNumber": 1, "date": "2030-01-15", "startTime": "12:00", "endTime": "13:30", "partySize": 2, "status": "CONFIRMED" }
  ]
}
```

El ejemplo abrevia el listado de bloques. Se generan desde apertura hasta cierre en intervalos de una hora; el último se recorta si el horario no completa una hora. La ocupación cuenta **mesas distintas** con reservas PENDING o CONFIRMED que se traslapan con el bloque, usando intervalos semiabiertos. Una reserva que termina al iniciar el bloque no lo ocupa. El porcentaje se redondea a dos decimales. Una sucursal sin mesas devuelve cero.

El denominador es **el total de mesas de la sucursal**, como indica H11, incluso mesas sin capacidad configurada o fuera de servicio. `availableTables` significa mesas sin reserva en ese bloque: no garantiza disponibilidad operativa. El estado actual OCCUPIED/OUT_OF_SERVICE de una mesa no permite inferir su estado físico en una fecha futura; la disponibilidad para crear una reserva sigue consultándose mediante H10. La cancelación no cambia el estado operativo de la mesa.

`reservations` lista las reservas de esa sucursal y fecha, incluidas las canceladas para consulta gerencial, ordenadas por `startTime ASC, id ASC`. Las canceladas no suman ocupación. No expone nombre, correo, teléfono ni identificador del cliente. Una transacción RepeatableRead mantiene consistencia entre conteos y listado durante cancelaciones concurrentes.

La cancelación no requiere body (también acepta `{}`); rechaza campos adicionales. Bloquea la reserva con `FOR UPDATE`, valida la sucursal y comprueba el plazo **después de obtener el bloqueo**. Permite exactamente dos horas de anticipación; un milisegundo después devuelve 400. Actualiza `status=CANCELLED` y `updatedAt` en una transacción. Una segunda cancelación, incluso concurrente, devuelve 400 `RESERVATION_ALREADY_CANCELLED` sin repetir el aviso. Devuelve el registro actualizado y `branchName`.

Errores uniformes `{code,message,field}`: 400 por datos inválidos, plazo vencido o reserva ya cancelada; 401 sin sesión; 403 para CUSTOMER/WAITER/KITCHEN; 404 por recurso inexistente o sucursal ajena al MANAGER. GENERAL_MANAGER puede seleccionar cualquier sucursal existente.

Después del commit de base de datos se llama al servicio existente de notificaciones con `reservation.cancelled:<id>`, destinatario obtenido de la reserva. Un fallo de notificación se registra sin revertir la cancelación; los reintentos persistentes de avisos no se implementan en H11.

### Pruebas y colección H11

Se reutiliza el entorno PostgreSQL local aislado descrito arriba; nunca se carga `backend/.env` desde el ejecutor QA.

```bash
npm run build --workspace backend
node backend/scripts/run-qa.cjs npm run test:h11 --workspace backend
node backend/scripts/run-qa.cjs npm run test:h10 --workspace backend
node backend/scripts/run-qa.cjs npm run test:integration --workspace backend
npm test --workspace backend
```

La suite H11 inicia una API temporal en el puerto 3324 y elimina exclusivamente sus fixtures. Comprueba sucursales con 12/10/8 mesas, duplicación de mesas en bloques, permisos, límite de dos horas, cancelaciones simultáneas, avisos y el flujo H10 → cancelación H11 → disponibilidad liberada. El error de notificación simulado en el log es intencional.

Se actualizó la prueba H10 que afirmaba que las rutas gerenciales no existían, pues ahora son parte de H11. Las verificaciones de reglas y creación de H10 se conservan. Las rutas H12 siguen pendientes.

Colección importable: `postman/H11-Reservations-Management.postman_collection.json` (27 solicitudes). Plantilla sin secretos: `postman/H11-Local.postman_environment.json`. Para preparar usuarios y mesas de QA se reutiliza `db:seed:h10:qa`; importar el entorno privado `postman/.env.h10.local` generado por ese comando, o copiar sus valores localmente a la plantilla H11. Elegir fecha futura con al menos dos horas de anticipación.

```bash
node backend/scripts/run-qa.cjs npm run db:seed:h10:qa --workspace backend
PORT=3310 node backend/scripts/run-qa.cjs node backend/dist/main.js
```

La colección crea una reserva mediante H10 y la cancela con H11. Cada solicitud incluye aserciones de estado y datos. JSON y scripts fueron validados; **Postman/Newman no se ejecutó para H11**. La verificación HTTP real se realizó con la suite automatizada. Evidencia: [H11_RESULTS.txt](../docs/qa/H11_RESULTS.txt).

### Entrega H11

Commit y título de PR: `feat(H11): consultar ocupacion y cancelar reservaciones (#42)`.
Razón: permitir que gerencia planifique la ocupación por sucursal y libere reservas respetando el plazo, los permisos y la concurrencia.

El PR final va hacia `develop`. Como H11 depende de H10, antes de fusionar H10 el PR H11 puede mostrar también sus cambios heredados. Christian debe revisar y fusionar primero H10 (#68); después verificar que el diff del PR H11 contenga únicamente esta historia, aprobarlo y fusionarlo. Si H10 se integra mediante squash o rebase, sincronizar la base de H11 antes de revisar su diff. No se hizo merge, rebase, commit ni push durante la implementación de H11.

Vincular el nuevo PR a #42 desde Development, pegar su enlace en la card del tablero y solicitar revisión a otro integrante. Se pueden completar las casillas técnicas de H11 con esta evidencia local; mantener la historia abierta y en revisión hasta aprobación y merge. La pausa de entrega ocurre aquí, antes de H12.
