# SDLC backend

## Arranque vigente: Docker Compose local (2026-11-13)

Después de integrar H10–H13 se completó el arranque exigido por la sección 2.1.2 de la especificación de cátedra: backend NestJS y PostgreSQL 16 local mediante Docker Compose, con Prisma. Supabase no es una dependencia del funcionamiento actual.

Con Docker iniciado y Node 22 o superior, desde la raíz:

```bash
npm start
```

El comando prepara la configuración privada si la instalación es nueva, construye el Dockerfile del backend, inicia PostgreSQL, espera su healthcheck, aplica migraciones pendientes, completa mesas/capacidades e insumos base sin restablecer registros existentes y arranca NestJS. Finalmente espera que la API esté saludable. Solo levanta `db` y `backend`; el frontend pertenece a un perfil opcional y no se publica ninguna web.

API: `http://127.0.0.1:3000/api`; health: `/api/health`. `npm stop` detiene ambos contenedores sin borrar el volumen; `npm run logs` muestra el backend. Los puertos son configurables en `.env.compose.local` y se publican solo en 127.0.0.1. También puede usarse directamente `docker compose --env-file .env.compose.local up -d --build --wait db backend` después de preparar el archivo privado.

Se conserva el nombre de proyecto Compose `sdlc-h10` para reutilizar `sdlc-h10_postgres_data`, con las credenciales y el nombre de base que ya tiene este equipo. No se crea una base por historia ni se renombra el volumen. En una instalación realmente nueva se genera una contraseña aleatoria; si existe el volumen pero falta su configuración, se detiene la preparación para no inventar credenciales incompatibles.

La conexión activa de `backend/.env` apunta ahora al PostgreSQL local. Antes de cambiarla se conserva una copia privada de la configuración previa en `backend/.env.previous-*`; esto no copia ni elimina bases. Docker utiliza la conexión al servicio `db`, no ese archivo del host. Los datos remotos previos se conservan sin nuevas escrituras. El archivo de accesos del equipo y los archivos `.env` quedan excluidos de Git y de la imagen Docker.

La inicialización automática crea únicamente datos base faltantes de H10/H13. Conserva mesas ocupadas, capacidades ya configuradas y existencias. No resetea movimientos, cuentas ni reservas. Las cuentas de equipo se provisionan con secretos privados; no se introducen contraseñas de login en este cambio.

Detalle del arreglo posterior a los merges: [CORRECCION_H10_H13_DOCKER.md](../docs/qa/CORRECCION_H10_H13_DOCKER.md). Las secciones siguientes conservan la explicación funcional y evidencia histórica de cada historia; sus instrucciones de PR anteriores al merge ya fueron superadas por la integración en develop.

## H10 - Table reservations

Story: [H10 / issue #41](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/41).
Branch: `feature/H10-table-reservations`, based on `develop`.

H10 implements customer reservation creation and the availability query needed to select a time. H11 adds management occupancy and cancellation. H12 adds customer reservation lists and cancellation, as documented below.

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

The Prisma seed requires three existing branch IDs through `RESERVATION_CENTRO_ID`, `RESERVATION_BAMBU_ID`, and `RESERVATION_RAMBLAS_ID`. It prepares 12/10/8 tables with the documented capacity groups. It fills unset capacities, preserves existing capacities and statuses, and can be repeated without duplicates. From the repository root, run `SEED_SCOPE=reservations npm run prisma:seed --workspace backend` with those variables only after selecting the intended database. Historical branch names and identities are not replaced automatically.

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

Se actualizó la prueba H10 que afirmaba que las rutas gerenciales no existían, pues ahora son parte de H11. Las verificaciones de reglas y creación de H10 se conservan. Las rutas de cliente se incorporan con H12, descrita más adelante.

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

## H12 - Consulta y cancelación de reservaciones propias

Historia: [H12 / issue #43](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/43), consultada directamente el 2026-11-10 y contrastada con el documento de historias y las instrucciones de backend. Rama: `feature/H12-reservaciones-propias`, basada en H11 `ab8be9d`. Al retomar el trabajo ya existían esta rama y cambios parciales sin commit, que se conservaron y verificaron.

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/me/reservations` | CUSTOMER; solo sus reservas |
| PUT | `/api/me/reservations/:id/cancel` | CUSTOMER; solo una reserva propia |

El listado devuelve un array de las reservaciones del `customerId` obtenido de la sesión verificada. Incluye activas, pasadas y canceladas en todas las sucursales donde ese cliente haya reservado, con orden `date ASC, startTime ASC, id ASC`. Sin reservas devuelve `[]`. No recibe filtros ni paginación; campos adicionales en la query devuelven 400 para evitar aparentar que puede elegirse otro cliente o sucursal.

Cada elemento contiene `id`, `branchId`, `branchName`, `tableId`, `tableNumber`, `date`, `startTime`, `endTime`, `partySize`, `status`, `createdAt` y `updatedAt`. No incluye correos, teléfonos, identificadores de otros clientes ni relaciones de usuario. Las fechas de agenda usan America/El_Salvador; las marcas de auditoría se serializan en UTC.

La cancelación acepta body omitido o `{}` y rechaza campos adicionales. Permite cancelar PENDING o CONFIRMED con al menos dos horas de anticipación, incluido el instante exacto del límite. La propiedad se comprueba antes de evaluar el estado y el plazo: una reserva ajena siempre devuelve 403, incluso si está cancelada o vencida; un identificador inexistente devuelve 404. Estas respuestas corresponden al contrato de #43.

Errores uniformes `{code,message,field}`:

- 400: ID inválido, parámetros no admitidos, plazo vencido o reserva ya cancelada.
- 401: sesión ausente, inválida o revocada.
- 403: rol distinto de CUSTOMER o reserva perteneciente a otro cliente.
- 404: reserva inexistente.

Se reutiliza `Reservation` y se extrae la cancelación de H11 a `reservation-cancellation.service.ts`. H11 y H12 delegan en este servicio con su política de acceso, conservando 404 para sucursal ajena en gerencia y 403 para propiedad ajena en cliente. El bloqueo `FOR UPDATE` y la comprobación del plazo posterior al bloqueo coordinan ambos endpoints. La actualización del cliente incluye `customerId` en el filtro, cambia `status=CANCELLED` y `updatedAt`, y no modifica el estado operativo de la mesa.

Después del commit de base de datos, el servicio existente H26/H28 envía `reservation.cancelled:<id>` al propietario. Cancelaciones concurrentes de cliente/cliente o cliente/gerente producen una sola respuesta 200, las siguientes 400, y un único aviso. Un fallo del aviso se registra sin revertir la cancelación. El listado, la ocupación H11 y la disponibilidad H10 reflejan el cambio en la próxima consulta.

### Código y verificación H12

- `src/reservations/customer-reservations.controller.ts`: rutas de cliente protegidas por la sesión existente.
- `src/reservations/customer-reservations.service.ts`: consulta restringida al propietario y delegación de cancelación.
- `src/reservations/reservation-cancellation.service.ts`: transacción, permisos según ruta y notificación compartidos con H11.
- `src/reservations/reservation-management.service.ts` y `reservations.module.ts`: reutilización del servicio e integración en el mismo módulo.
- `test/h12-integration.test.cjs`: aislamiento entre clientes, orden del historial, permisos, plazos, concurrencia e integración H10/H11/H26/H28.

No se agregan tablas, migraciones ni dependencias; se requiere la migración H10 existente. No se modificó Supabase. No se implementó frontend ni otra historia.

```bash
npm run build --workspace backend
node backend/scripts/run-qa.cjs npm run test:h12 --workspace backend
node backend/scripts/run-qa.cjs npm run test:h11 --workspace backend
node backend/scripts/run-qa.cjs npm run test:h10 --workspace backend
node backend/scripts/run-qa.cjs npm run test:integration --workspace backend
npm test --workspace backend
```

Se reutiliza `.env.h10.qa.local`, privado, que selecciona PostgreSQL local `sdlc_h10_test`. La suite H12 inicia una API temporal en el puerto 3325, crea sus propios usuarios/reservas y elimina únicamente sus fixtures. El test de fallo de notificación produce un log de error intencional. El límite exacto de dos horas y su conversión de zona horaria se verifican en `h11-rules.test.cjs`, sobre la misma regla que invoca H12.

Resultados del 2026-11-10: build correcto; H12 18 pruebas aprobadas (17 escenarios y test padre); H11 23; H10 28; cinco suites existentes y 108 comprobaciones HTTP de integración aprobadas. H10 pasa de 29 a 28 porque se retira la aserción obsoleta que exigía 404 en las rutas ahora implementadas de H12. En H11 solo se adapta la construcción del servicio en el test de fallo de notificación al nuevo servicio compartido. Evidencia: [H12_RESULTS.txt](../docs/qa/H12_RESULTS.txt).

Colección: `postman/H12-Customer-Reservations.postman_collection.json` (26 solicitudes). Plantilla sin secretos: `postman/H12-Local.postman_environment.json`. Reutiliza los usuarios y el entorno privado generados por `db:seed:h10:qa`, descritos arriba. Crea una reserva futura con H10, consulta el historial, cancela y verifica el aviso. JSON, scripts y cuerpos validados; **no se ejecutó Postman/Newman para H12**, se ejecutaron las pruebas HTTP automatizadas. Los casos de otro cliente, plazo y concurrencia están en la suite H12.

### Entrega H12

Título del commit y PR: `feat(H12): consultar y cancelar reservaciones propias (#43)`.
Razón: permitir al cliente gestionar sus propias reservas sin acceder a las de otro usuario y liberar disponibilidad dentro del plazo permitido.

El PR final va hacia `develop`, con H12 #43 vinculada, Marceloereyes como assignee y otro integrante como reviewer. La rama hereda H10/H11 porque todavía no estaban integradas al iniciar este trabajo; primero se deben aprobar y fusionar esas dependencias, después revisar el diff de H12. Si las dependencias se integran mediante squash o rebase, sincronizar la base antes de revisar el diff. Mantener el PR abierto hasta aprobación, sin merge automático.

Pegar el enlace del PR en la card H12 y ponerla en revisión si el tablero dispone de ese estado. Las casillas técnicas se respaldan con la evidencia local; no equivalen a despliegue en Supabase ni a aprobación de otro integrante. No se ejecutaron commit, push ni merge durante esta entrega. Pausa antes de H13.

## H13 - Consulta de niveles de inventario

Historia: [H13 / issue #44](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/44), consultada el 2026-11-10 y contrastada con el documento de historias. Rama: `feature/H13-consulta-inventario`, basada en H12 `ff23826` mientras las historias anteriores esperan revisión e integración.

`GET /api/management/branches/:branchId/inventory` devuelve un array de insumos con `id`, `branchId`, `name`, `unit`, `minStock` y `currentStock`, ordenados por `name ASC, id ASC`. MANAGER solo puede consultar su sucursal asignada; GENERAL_MANAGER puede seleccionar cualquier sucursal existente. La identidad y la sucursal asignada se obtienen de la sesión verificada. Una sucursal existente sin insumos devuelve `200 []`. Cada consulta lee las existencias persistidas, sin modificarlas.

Errores uniformes `{code,message,field}`: 400 por UUID inválido o filtros no admitidos; 401 sin sesión válida; 403 para CUSTOMER, WAITER y KITCHEN; 404 por sucursal inexistente, ajena al MANAGER o gerente sin sucursal asignada. H13 no define filtros ni paginación.

El módulo `src/inventory` contiene controlador, servicio y módulo NestJS, siguiendo la estructura del backend existente. Reutiliza Prisma y la autenticación común. No agrega dependencias. La migración `20261110000000_h13_inventory_items` crea `InventoryItem`, con cantidades enteras no negativas, nombre/unidad obligatorios, relación a Branch y unicidad de nombre por sucursal. No cambia datos de los módulos existentes. Esta historia consulta insumos; los movimientos manuales y las alertas corresponden a H14/H15. El inventario no se descuenta automáticamente por recetas ni pedidos.

### Seed de insumos

`prisma/seed-inventory.cjs` prepara un catálogo **de ejemplo** por sucursal: Arroz y Harina (g, mínimo 5000), Aceite (ml, mínimo 2000), Sal (g, mínimo 500) y Tomate (unidad, mínimo 20), todos con existencia inicial 0. Los documentos no fijan un catálogo ni cantidades iniciales: deben ajustarse a los insumos y umbrales acordados antes del despliegue compartido. Cero no representa un conteo físico verificado.

El seed valida que los IDs sean distintos y que todas las sucursales existan antes de insertar. Puede repetirse, incluso concurrentemente, sin duplicar insumos ni reemplazar cantidades, unidades o mínimos existentes. Solo actúa sobre las sucursales indicadas; no crea sucursales ni modifica mesas.

El punto de entrada de Prisma admite `SEED_SCOPE=inventory` e `INVENTORY_BRANCH_IDS`, separados por comas. El scope por defecto sigue siendo `reservations` para conservar H10. Desde la raíz, con las variables privadas de conexión apuntando a la base elegida y las migraciones aplicadas:

```bash
SEED_SCOPE=inventory INVENTORY_BRANCH_IDS='<uuid-centro>,<uuid-bambu>,<uuid-ramblas>' npm run prisma:seed --workspace backend
```

El comando se ejecuta en el workspace backend, donde está configurado `prisma.seed`. La prueba H13 verifica ese punto de entrada real sin requerir IDs de mesas/reservaciones.

### Verificación local H13

Se reutiliza el PostgreSQL local aislado y `.env.h10.qa.local` descritos arriba. No se aplicaron migraciones ni seeds en Supabase.

```bash
node backend/scripts/run-qa.cjs ./node_modules/.bin/prisma generate --schema backend/prisma/schema.prisma
node backend/scripts/run-qa.cjs ./node_modules/.bin/prisma migrate deploy --schema backend/prisma/schema.prisma
npm run build --workspace backend
node backend/scripts/run-qa.cjs npm run test:h13 --workspace backend
```

La suite inicia la API en el puerto 3326, crea sus propias sucursales/usuarios y elimina únicamente esos fixtures. Verifica permisos, aislamiento, sesión revocada, listado completo, sucursal vacía/inexistente, recarga del stock persistido, restricciones de base y seed repetible/concurrente. Resultado: 16 escenarios y test padre aprobados; también pasan H10 (28), H11 (23), H12 (18), 25 pruebas unitarias y 108 comprobaciones HTTP existentes. Esquema válido y migraciones locales actualizadas. Evidencia: [H13_RESULTS.txt](../docs/qa/H13_RESULTS.txt).

Colección: `postman/H13-Inventory.postman_collection.json`, con 23 solicitudes. Plantilla sin secretos: `postman/H13-Local.postman_environment.json`. Para preparar sucursales y usuarios locales e iniciar la API:

```bash
node backend/scripts/run-qa.cjs npm run db:seed:h13:qa --workspace backend
PORT=3310 node backend/scripts/run-qa.cjs node backend/dist/main.js
```

Importar la colección y el entorno privado generado en `postman/.env.h13.local`. Este archivo contiene credenciales aleatorias, queda ignorado por Git y no se entrega. El seed QA solo admite una base local con nombre terminado en `_test`. Crea dos sucursales con insumos y una vacía. JSON, cuerpos y scripts de la colección fueron validados; **Postman/Newman no se ejecutó**, la evidencia HTTP corresponde a las pruebas automatizadas anteriores.

### Entrega H13

Título del commit y PR: `feat(H13): consultar inventario por sucursal (#44)`.
Razón: permitir a gerencia consultar existencias de insumos con aislamiento por sucursal y datos iniciales repetibles, sin alterar el stock durante la consulta.

El PR va hacia `develop`. La rama hereda H10-H12; revisar e integrar esas historias primero, y comprobar después que el diff de H13 contenga solo esta historia. Si se integran mediante squash/rebase, sincronizar su base antes de revisarla. La aprobación debe realizarla otro integrante; mantener el PR abierto hasta entonces.

Vincular el PR a #44 desde Development y copiar su enlace a la card H13. Al consultar la issue, seguía asignada a DiegoJacob0: actualizar responsable y planificación según el reparto acordado por el equipo antes de presentarla como trabajo individual. Las casillas backend pueden marcarse con esta evidencia; frontend, despliegue compartido, aprobación y merge siguen pendientes. Poner la card en revisión si existe ese estado; en caso contrario mantener In progress. No marcar Done todavía.

H13 se entrega sin commit ni push para que el responsable los realice. La pausa de esta entrega ocurre antes de H14.
