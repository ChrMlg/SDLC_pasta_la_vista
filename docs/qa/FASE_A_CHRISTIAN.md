# Fase 1 — Integración del backend de Christian

Fecha: 8 de noviembre de 2026 (America/El_Salvador).

**Estado: correcciones verificadas en PostgreSQL local; integración completa parcialmente terminada.** Supabase conecta y el backend arranca con `GET /api/health` = 200, pero `public` está vacío. No se aplicaron migraciones remotas. Persisten dependencias de M3, M4 y M7 descritas al final; no se declara completado el producto completo.

Rama: `f/marcelo-integracion-backend-christian`, basada en la referencia local `origin/develop`, commit `8cd4d8f`. El usuario llamó a la base “developed”; el nombre existente es `develop`. La siguiente fase deberá usar `f/marcelo-inventory-reservations-reviews` desde `develop` después de que el usuario integre esta fase. No se realizaron commits, pushes, merges ni PR.

## Repositorio y entorno comprobados

- `main` era el boilerplate NestJS 12 / Prisma 7. Los módulos de Christian están en `origin/develop`, bajo `backend/src`, con NestJS 10 y Prisma **5.22.0**. Se preservó ese stack, sin `prisma init` ni actualización de major.
- Se instaló el conjunto declarado y se agregó `package-lock.json`; Docker usa `npm ci` con ese lockfile. Node del host: 22.22.3. Compose: 5.1.4. PostgreSQL de Compose: 16; Supabase: 17.11.
- No hay frontend en esta referencia, aunque el workspace y Compose lo mencionan. No se creó ni modificó frontend. Se usaron comandos `--workspace backend` y `up ... db backend`.
- El `backend-build.log` histórico contenía errores de TypeScript. **El build original actual sí pasó**; no se atribuyen esos errores históricos a esta revisión.
- Se conservó la autenticación existente de esta rama: cookie `bistro_session`, token aleatorio cuyo hash se almacena, scrypt para contraseñas. No se introdujo otra autenticación ni Supabase Auth.
- La consulta de nuevas referencias al remoto falló por permisos de la configuración SSH local. No se afirma que `origin/develop` coincida con cambios posteriores en GitHub.
- Figma no fue accesible. Las reglas se contrastaron con las historias y la especificación adjuntas.

## Errores reproducidos y correcciones

| Caso | Antes, comprobado por HTTP | Después |
|---|---|---|
| MANAGER crea cuenta de TAKEAWAY | 201 indebido | 403; operaciones de cobro limitadas a WAITER de sucursal y CUSTOMER propietario |
| MANAGER paga con número que no cumple Luhn | 201, `APPROVED` | 403; para cliente autorizado la tarjeta inválida da 422 |
| Cuerpo completo H17 | 422 porque solo se admitía `cardNumber` | 200 con titular, 16 dígitos/Luhn, vencimiento, CVV y terminación de prueba validados |
| Estado/HTTP del pago | `APPROVED`, HTTP 201 | `PAID`, HTTP 200, `paymentId`, `billStatus`, `receiptId` |
| Registro de TAKEAWAY | 0 avisos al cliente | Aviso `order.created` después del commit; cocina espera el pago |
| Comprobantes | Array sin paginación | `{data,total,page,pageSize:10}` y propiedad fijada en `Bill.clientId` |
| Filtro de notificaciones inválido | 200, filtro ignorado | 422; filtro `sourceModule` aplicado |

Otras correcciones verificadas:

- Un solo cliente Prisma, con conexión y desconexión ligadas al ciclo de Nest, en lugar de cinco pools independientes. Health consulta `SELECT 1`; el healthcheck Docker comprueba HTTP exitoso.
- Configuración Prisma 5: `url=DATABASE_URL`, `directUrl=DIRECT_URL`. La conexión de migraciones debe usar sesión/directa; no se copió la configuración de Prisma 7 de `main`. Referencias: [Supabase y Prisma](https://supabase.com/docs/guides/database/prisma) y [conexiones PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres). No se modificaron las credenciales del usuario.
- Registro de cliente con nombre/apellido, teléfono de ocho dígitos y contraseña mínima de ocho caracteres; no acepta rol ni sucursal. `isActive=false` invalida login y sesiones existentes. Los campos nuevos de perfiles históricos quedan anulables, sin inventar datos personales.
- Montos de cierre calculados desde `OrderItem.unitPrice × quantity`; cambios posteriores de menú no cambian el precio histórico. IVA 13 %, aritmética decimal/centavos.
- `Bill.clientId` se fija al cerrar y se usa para consultar, pagar y descargar. Compatibilidad: es el cliente común únicamente cuando todos los pedidos de la cuenta tienen el mismo cliente no nulo; en cualquier otro caso es nulo. No se reasigna una cuenta por una vinculación posterior.
- Código de vinculación con formato 400, vencido/consumido 409, resumen de mesa y cantidad, autor `createdById` y fecha `clientLinkedAt`. Consumo concurrente probado: un 201 y un 409.
- Los conflictos de serialización de pagos (`P2034` y SQLSTATE `40001`/`40P01` de consultas raw) se reintentan de forma acotada, sin repetir la pasarela ni una transacción confirmada. La prueba de dos cuentas simultáneas reprodujo primero 409/500 y permitió comprobar la corrección.
- La entrega legacy ya no salta desde READY ni modifica la comanda a DELIVERED; recibe el aviso M9 después del commit. No se desarrolló el flujo completo de M3.
- Una mesa con cuenta OPEN no admite nuevos pedidos mientras se cobra. La liberación manual/logout no ignora pedidos pendientes creados por un mesero.
- M9 expone su servicio interno `createNotification`, valida destinatario y contexto y conserva unicidad por destinatario/evento. No hay endpoint público de emisión. READY avisa al cliente; autoservicio avisa a meseros activos de su sucursal. Avisos de entrega no se envían a cocina.
- Consultas H29/H30 en las rutas documentadas, con filtros y permisos por sucursal. Son vistas de seguimiento; no se implementaron nuevas transiciones de M3.
- PDF de comprobantes con paginación; prueba de 100 platillos produce tres páginas, conserva caracteres españoles, último platillo y total. Render final inspeccionado.
- `.env` y variantes privadas ignoradas por Git y excluidas del contexto Docker; plantillas de conexión sin credenciales. El entorno Postman versionado tiene credenciales/cookies vacías.

## Cambios de contrato y compatibilidad

Estos cambios son intencionales y deben comunicarse al responsable del frontend, que no fue modificado:

1. H17 exige los cinco campos de tarjeta documentados y responde `PAID`/200. Se conserva `id` como alias de `paymentId`.
2. H18 devuelve un objeto paginado, no un array directo.
3. Registro de cliente requiere el perfil documentado. Las cuentas existentes conservan sus datos; los campos históricos ausentes siguen nulos.
4. Se mantienen `tax` y `discount` como aliases de `taxAmount` y `discountAmount` en la respuesta de cuenta. Se mantienen tablas/relaciones existentes (`Payment.billId`, `Receipt.snapshot`, enum `Role`) y se documenta su equivalencia en lugar de duplicarlas.
5. `Order.clientId` es canónico; no se agregó `customerId` duplicado por la discrepancia de H5.
6. Los errores de vinculación y filtros de M9 se alinean con el contrato escrito. Las claves de eventos antiguos se normalizan en una migración separada.

## Matriz de cobertura

| Historias | Estado en esta revisión | Evidencia / limitación |
|---|---|---|
| H1–H3 Menú | Comprobadas en local | Pruebas existentes, PostgreSQL real, HTTP, aislamiento y concurrencia |
| H4–H5 Pedidos | Comprobados flujos principales | DINE_IN, TAKEAWAY, validaciones, vinculación concurrente; no hay clave de idempotencia de creación en el contrato actual |
| H16 Cierre | Comprobado en local | Precio histórico, IVA, autorización, mesa pendiente/entregada; estado DELIVERED preparado como fixture, no atribuido a M3 |
| H17 Pago | Comprobado sin lealtad | Aprobado/rechazado, permisos, validaciones, idempotencia, timeout, concurrencia sobre una cuenta y sobre dos cuentas de la misma sucursal, comanda única |
| H18 Comprobantes | Comprobado en local | Propiedad, inmutabilidad, paginación, PDF y correlativo transaccional existente |
| H26–H27 Notificaciones | Comprobadas para pedidos | Unicidad, destinatarios, filtros, aislamiento; no se declara entrega de un aviso si el registro falla |
| H28 Reservaciones | Pendiente de M4 | Existe puerto de integración; todavía no hay Reservation ni implementación del resolver. Confirmación/cancelación remota no probadas |
| H29–H30 Seguimiento | Consultas/avisos comprobados | Transiciones de negocio completas dependen de M3; se usaron fixtures persistidos para verificar avisos |

## Pruebas ejecutadas

| Comando / prueba | Resultado |
|---|---|
| Build original antes de cambios | Aprobado |
| `npm run build --workspace backend` | Aprobado después de cambios |
| `npm test --workspace backend` | 5 archivos de pruebas aprobados (runner Node); no se confunden con 5 historias |
| `npm run test:integration --workspace backend` con entorno local privado | **108 comprobaciones HTTP/concurrencia aprobadas**, más aserciones de base de datos |
| `npm run test:catalog:db --workspace backend` | 1 prueba PostgreSQL aprobada |
| `npm run test:catalog:availability:db --workspace backend` | 1 prueba PostgreSQL aprobada; incluye auditoría y rollback |
| `npm run test:catalog:menu:db --workspace backend` | 1 prueba PostgreSQL aprobada |
| `prisma migrate deploy` en `sdlc_phase1_test` | 11 migraciones aplicadas; sin reset ni borrado de bases existentes |
| `docker compose ... build backend` | Aprobado, cliente generado y TypeScript compilado en imagen |
| Compose `db backend` + `/api/health` | Aprobado, HTTP 200 |
| `DATABASE_URL` y `DIRECT_URL` Supabase, consultas de lectura | Ambas aprobadas; servidor 17.11, esquema public sin tablas |
| Backend conectado a Supabase + `/api/health` | Aprobado, HTTP 200 y SELECT 1; **no equivale a comprobar CRUD remoto** |
| PDF 100 platillos | Tres páginas; texto y render verificados |
| Seed QA local, dos ejecuciones | Aprobadas, upsert de cuentas/sucursales/mesa; no se versionan contraseñas |
| Postman/Newman Runner | **No ejecutado en esos runners**. Se entregan 43 solicitudes importables; pruebas HTTP reales ejecutadas con `fetch` de Node y PostgreSQL |

La primera ejecución de la nueva suite falló por un correo de fixture con mayúsculas que no coincidía con la normalización del login; se corrigió el fixture. La regresión posterior pasó. La prueba ampliada de cuentas concurrentes reprodujo conflictos SQL de serialización y se corrigió antes de la ejecución final. La compilación intermedia con cliente Prisma desactualizado falló; se regeneró con 5.22 y pasó. No son fallos finales pendientes.

## Migraciones revisables y despliegue remoto pendiente

- `20261108000000_phase1_integration`: renombra el valor `APPROVED` a `PAID` conservando filas; agrega enums y campos de perfil/activación, propietario de cuenta y auditoría de vínculos. Backfill de propietario solo si la identidad es inequívoca. No inventa actor/fecha para códigos históricos.
- `20261108010000_notification_event_keys`: normaliza claves de eventos conservando avisos. Antes de desplegar sobre una base con datos, revisar que las claves resultantes no colisionen; la restricción única detiene la migración ante colisión.
- No se editaron las nueve migraciones históricas. Incluyen sucursales y cuentas demo. Sus sucursales no coinciden completamente con Centro/Bambu/Ramblas de las historias; no se renombraron ni borraron registros históricos silenciosamente.
- Supabase fue consultado solamente con SELECT. Aplicar `migrate deploy` allí ejecutaría **las once migraciones**, incluidas las semillas históricas. Requiere revisión del contenido demo y autorización expresa del dueño. No ejecutar `migrate dev`, `db push` ni `migrate reset` sobre esa base.

## Pendientes y límites

1. **M3 fuera de alcance:** se corrigió únicamente la ruta legacy existente para rechazar READY → DELIVERED y conservar la comanda READY al entregar desde OUT_FOR_DELIVERY. No se implementaron toma/liberación, preparado por ítem ni recogida con los endpoints canónicos de M3. `KitchenTicket.status` todavía reutiliza el enum OrderStatus del esquema existente; su enum específico, campos de auditoría y regularización de comandas históricas quedan para M3. Las pruebas preparan esos estados mediante fixtures explícitos; no equivalen al flujo completo de Cocina.
2. **M4 pendiente:** H28 no puede comprobarse hasta tener reservaciones y conectar el puerto con su persistencia real. Los mensajes detallados de reserva (mesa, fecha, hora y sucursal) deben completarse con ese contexto.
3. **M7 ajeno al alcance:** no hay servicio de lealtad para descuentos, acumulación o reversos. No se implementó ni se afirmó que funcione. Los cobros probados son sin canje.
4. Supabase sin esquema: CRUD remoto pendiente de autorización de migraciones. Health prueba conectividad, no historias de negocio.
5. El timeout se comprobó con un intento PENDING de más de 30 segundos y un reintento posterior; no se simuló una caída real del proceso ni se agregó un worker de recuperación. Los pagos simultáneos de dos cuentas distintas de la misma sucursal sí se verificaron: ambos aprobados, correlativos distintos.
6. Consultas H29/H30 son polling; no se implementó un transporte WebSocket/SSE. No se afirma tener envío push.
7. Postman preparado, aún no ejecutado en Runner/Newman; usar el entorno privado local. No subirlo a Git ni exportar sus valores.

## Reproducción local y Postman

La ejecución dejó el proyecto Compose `sdlc-phase1`, base local `sdlc_phase1_test`, puerto PostgreSQL 55439 y API 3309. Los contenedores ajenos no se modificaron. `.env.qa.local` contiene únicamente la conexión a esa base local de prueba; `backend/.env` sigue siendo la conexión privada del usuario a Supabase.

Desde la raíz del repositorio:

```bash
npm ci --workspace backend --ignore-scripts
node --env-file=.env.qa.local node_modules/prisma/build/index.js generate --schema backend/prisma/schema.prisma
npm run build --workspace backend
npm test --workspace backend
node --env-file=.env.qa.local backend/test/integration.cjs
node --env-file=.env.qa.local backend/scripts/seed-qa.cjs
```

Para Compose (solo local):

```bash
docker compose -p sdlc-phase1 -f compose.yaml -f compose.test.yaml --env-file .env.qa.local up -d --build db backend
curl --fail http://localhost:3309/api/health
```

Importar `postman/SDLC-Backend.postman_collection.json` y `postman/.env.local`. El segundo es un entorno **privado generado localmente**, ignorado por Git, con usuarios ficticios y contraseñas aleatorias. Ejecutar las cinco carpetas en orden. Para compartir usar `postman/SDLC-Local.postman_environment.json`, que tiene los secretos vacíos. La colección usa cookies independientes por rol y desactiva el cookie jar por petición para no confundir sesiones. Cada ejecución crea datos de prueba nuevos.

La suite HTTP rechaza conexiones no locales o bases cuyo nombre no termine en `_test`, inicia su propia API en 3319 y limpia únicamente los fixtures de esa ejecución. No apunta a Supabase.

## Archivos modificados o agregados

- `.dockerignore`
- `.gitignore`
- `backend/.env.example`
- `backend/Dockerfile`
- `backend/package.json`
- `backend/prisma/migrations/20261108000000_phase1_integration/migration.sql`
- `backend/prisma/migrations/20261108010000_notification_event_keys/migration.sql`
- `backend/prisma/schema.prisma`
- `backend/scripts/seed-qa.cjs`
- `backend/src/auth/auth.module.ts`
- `backend/src/auth/auth.service.ts`
- `backend/src/billing/billing.controller.ts`
- `backend/src/billing/billing.module.ts`
- `backend/src/billing/billing.service.ts`
- `backend/src/billing/dto/payment.dto.ts`
- `backend/src/billing/receipt-pdf.ts`
- `backend/src/main.ts`
- `backend/src/menu/menu.module.ts`
- `backend/src/notifications/notifications.controller.ts`
- `backend/src/notifications/notifications.module.ts`
- `backend/src/notifications/notifications.service.ts`
- `backend/src/notifications/order-notifications.controller.ts`
- `backend/src/orders/order-tracking.controller.ts`
- `backend/src/orders/order-transition.ts`
- `backend/src/orders/orders.module.ts`
- `backend/src/orders/orders.service.ts`
- `backend/src/orders/prisma-orders.repository.ts`
- `backend/src/orders/seating.controller.ts`
- `backend/src/prisma/prisma.module.ts`
- `backend/test/integration.cjs`
- `backend/test/order-transition.test.ts`
- `backend/test/orders.test.ts`
- `compose.test.yaml`
- `compose.yaml`
- `docs/qa/FASE_A_CHRISTIAN.md`
- `docs/qa/FASE_A_RESULTADOS.txt`
- `package-lock.json`
- `postman/SDLC-Backend.postman_collection.json`
- `postman/SDLC-Local.postman_environment.json`

- `docs/qa/PR_FASE_A.md`

## Comandos Git para el dueño (no ejecutados)

La base del PR es `develop`, no `main`. El primer comando Git crea la rama con nombre en inglés y conserva los cambios locales pendientes; HEAD y origin/develop coinciden al preparar estos comandos. Revisar el diff antes de confirmar; los comandos no incluyen los entornos privados. La consulta al remoto falló por SSH, por lo que el usuario debe resolver ese acceso antes del push.

```bash
cd /home/marcelor/Escritorio/SDLC_pasta_la_vista
git switch -c f/marcelo-christian-backend-integration origin/develop
git status --short --branch
git diff --check
git diff
git add -- .dockerignore .gitignore backend/.env.example backend/Dockerfile backend/package.json backend/prisma/migrations/20261108000000_phase1_integration/migration.sql backend/prisma/migrations/20261108010000_notification_event_keys/migration.sql
git add -- backend/prisma/schema.prisma backend/scripts/seed-qa.cjs backend/src/auth/auth.module.ts backend/src/auth/auth.service.ts backend/src/billing/billing.controller.ts backend/src/billing/billing.module.ts backend/src/billing/billing.service.ts
git add -- backend/src/billing/dto/payment.dto.ts backend/src/billing/receipt-pdf.ts backend/src/main.ts backend/src/menu/menu.module.ts backend/src/notifications/notifications.controller.ts backend/src/notifications/notifications.module.ts backend/src/notifications/notifications.service.ts
git add -- backend/src/notifications/order-notifications.controller.ts backend/src/orders/order-tracking.controller.ts backend/src/orders/order-transition.ts backend/src/orders/orders.module.ts backend/src/orders/orders.service.ts backend/src/orders/prisma-orders.repository.ts backend/src/orders/seating.controller.ts
git add -- backend/src/prisma/prisma.module.ts backend/test/integration.cjs backend/test/order-transition.test.ts backend/test/orders.test.ts compose.test.yaml compose.yaml docs/qa/FASE_A_CHRISTIAN.md
git add -- docs/qa/FASE_A_RESULTADOS.txt package-lock.json postman/SDLC-Backend.postman_collection.json postman/SDLC-Local.postman_environment.json
git add -- docs/qa/PR_FASE_A.md
git diff --cached --stat
git commit -m "fix(backend): correct menu orders payments and notifications integration"
git push -u origin f/marcelo-christian-backend-integration
```

Para abrir el PR con GitHub CLI, únicamente cuando el usuario decida subirlo:

```bash
gh pr create --base develop --head f/marcelo-christian-backend-integration --title "Fix Christian backend integration" --body-file docs/qa/PR_FASE_A.md
```

Alternativa en GitHub: base `develop`, compare `f/marcelo-christian-backend-integration`. La revisión y el merge los realiza el dueño. La Fase 2 no se inició. Una vez integrado, la siguiente rama se creará desde `develop` con el prefijo solicitado `f/marcelo-`.
