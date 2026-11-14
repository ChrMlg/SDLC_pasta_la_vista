# H15 — Alertas de reabastecimiento de insumos

Historia: [#46](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/46). Fecha de revisión: 2026-11-13.
Rama: `feature/H15-alertas-reabastecimiento`.

## Base y alcance

Se consultaron la descripción vigente de la issue, el PDF de historias (H15, páginas 41–42) y las indicaciones del proyecto. El alcance es backend NestJS/Prisma con PostgreSQL local y Docker Compose. Las decisiones actuales del responsable prevalecen sobre la antigua propuesta de conexión remota. No se modifican frontend ni ramas anteriores. Se simplifican los archivos de configuración local sin cambiar las credenciales existentes.

Al comenzar, `origin/develop` estaba en `4079d41`; H14 todavía no estaba integrada. Esta rama parte de H14 (`c7c566f`) porque necesita sus movimientos y el modelo InventoryAlert. H15 se entrega con commit y push autorizados por el responsable; el PR y el tablero quedan a su cargo. No se hace merge de H14 ni de H15.

## Implementación y contrato

- Después de cada movimiento H14 confirmado dentro de su transacción, si el stock resultante es menor o igual al mínimo, se crea una alerta ACTIVE solamente si no existe una activa para ese insumo.
- Se utiliza el bloqueo de fila del insumo de H14 y el índice único parcial `InventoryAlert_one_active_item`. Las solicitudes simultáneas no duplican alertas ni pierden movimientos.
- La entrada que supera el mínimo resuelve la alerta con el usuario de sesión y la fecha. Otra caída posterior crea un período distinto, conservando el anterior.
- Si falla la persistencia de la alerta se revierte también el movimiento y el stock. No hay cron ni descuento automático por pedidos de cocina.
- `GET /api/management/branches/:branchId/inventory/alerts`: MANAGER de esa sucursal o GENERAL_MANAGER. Devuelve `200 []` si existe la sucursal y no tiene alertas. Devuelve 401 sin sesión, 403 para otros roles, 404 para sucursal inexistente o fuera de alcance y 400 para UUID o parámetros inválidos.
- Listado completo de ACTIVE y RESOLVED, ordenado por fecha descendente y UUID descendente en empates. Sin filtros adicionales, pues la historia no los define.
- Cada objeto incluye los campos de InventoryAlert, `branch.name` e `item: { name, unit, currentStock, minStock }`. Los campos `currentStock/minStock` de la alerta conservan la medición que originó el período; los campos de `item` muestran las existencias y el mínimo actuales. Así se conserva la auditoría de H14 sin mostrar existencias antiguas como actuales.
- Consultar alertas no genera registros. La evaluación ocurre al registrar movimientos.

No se requiere nueva migración: se reutilizan el modelo, las restricciones y el índice de H14. No se reescriben migraciones aplicadas ni se crea otra base de datos.

## Validación y ejecución local

Desde la raíz, con Docker iniciado:

```bash
npm start
node backend/scripts/run-qa.cjs npm run test:h15 --workspace backend
H15_API_URL=http://127.0.0.1:3000/api node backend/scripts/run-qa.cjs npm run test:h15 --workspace backend
```

El primer comando construye el Dockerfile y levanta backend/PostgreSQL. Las pruebas obtienen la conexión directamente de `.env.compose.local`, la misma base persistente del backend; no se crea una base por historia. Crean sucursales, usuarios e insumos temporales con UUID y eliminan únicamente sus propios registros al finalizar. En el segundo modo se consulta la API real del contenedor.

H15: 19 escenarios y una prueba contenedora (20/20) aprobados en ambos modos. Se verificó la conservación exacta de datos existentes, movimientos y alertas mediante una huella antes/después. Regresiones H10–H14, unitarias e integración: resultados en `H15_RESULTS.txt`.

La colección `postman/H15-Inventory-Alerts.postman_collection.json` contiene 20 solicitudes de consulta y autenticación, con 26 scripts validados sintácticamente. Usar el entorno privado existente `postman/.env.project.local` o completar la plantilla H15 local sin subir secretos. No se ejecutó Postman/Newman: la validación HTTP real se hizo con la suite automatizada. La colección no cambia existencias; el ciclo completo y la concurrencia se verifican con `test:h15`.

## Configuración local y equipo

- `.env.compose.local`: fuente privada de las credenciales y puertos de Docker; `.env.compose.example` es la plantilla versionada.
- `backend/.env`: conexión local derivada por `npm start` para herramientas Node/Prisma; `backend/.env.example` describe las variables sin valores privados. No genera archivos `.env.previous-*`.
- `.env.project.credentials`: cuentas de la aplicación para la carga opcional del equipo, no credenciales de PostgreSQL. Se conserva sin cambiar las cuentas.
- `postman/.env.project.local`: único entorno privado de Postman conservado, con la API local y cuentas existentes.
- Se retiraron la configuración anterior de conexión remota, su entorno Postman, las configuraciones QA duplicadas y los scripts archivados de QA remota. No se eliminaron bases, volúmenes ni datos. Las menciones remotas en reportes históricos son evidencia anterior, no configuración activa.

Cada compañero puede usar su propia configuración: instalar dependencias con `npm ci` y ejecutar `npm start` con Docker iniciado y Node 22 o superior. Una instalación nueva genera una contraseña local; no necesita recibir el `.env` de otra computadora. Si ya existe un volumen, conservar el archivo privado que corresponde a ese volumen.

Para utilizar las mismas cuentas de demostración, compartir **por un canal privado** `.env.project.credentials` y colocarlo en la raíz. Con la base levantada, ejecutar:

```bash
npm run prisma:generate --workspace backend
npm run build --workspace backend
node backend/scripts/project-db.cjs local seed
node backend/scripts/export-team-access.cjs
```

La carga completa los registros faltantes y verifica las cuentas; no sobrescribe contraseñas ni existencias. El texto `accesos-equipo-privado.txt` permite consultar los logins, pero por sí solo no crea cuentas en otra computadora. Cada base local conserva sus propios movimientos y reservas; no se sincronizan automáticamente.

Las suites históricas mantienen su protección que exige un nombre de base terminado en `_test`. La base persistente de esta computadora ya cumple ese requisito (`sdlc_h10_test`); no se crea ni se renombra ninguna base para ejecutar H15. El arranque normal de una instalación nueva no depende de ejecutar esas suites.

## Commit y subida

Commit autorizado y subido en `feature/H15-alertas-reabastecimiento`:

```text
feat(H15): generar y consultar alertas de reabastecimiento (#46)
```

Razón del commit:

```text
Evalua el stock dentro de cada movimiento, evita alertas activas duplicadas y conserva el historial de resolucion. Permite consultar alertas por rol y sucursal. Incluye pruebas de concurrencia, rollback y Docker local. Unifica la conexion de pruebas con Compose y elimina la generacion de respaldos de configuracion anteriores.
```

## Avance de los cinco módulos acordados

H10–H12: módulo 4, integrado. H13–H15: módulo 5, implementado; H14/H15 pendientes de revisión e integración. Quedan 12 historias por desarrollar: módulo 3 (H6–H9), módulo 8 (H23–H25), módulo 10 (H31–H35). El siguiente módulo según el orden acordado es reseñas, empezando por H23.

La asignación de GitHub todavía no coincide por completo con ese reparto: H31/H32 figuran asignadas a Christian y H33–H35 sin responsable; H26 figura a nombre de Marcelo aunque el módulo 9 corresponde a Christian según el acuerdo. Coordinar esas asignaciones antes de evaluar trabajo individual; no se cambiaron desde esta entrega.

## PR y tablero

Destino requerido: `develop`. Compare: `feature/H15-alertas-reabastecimiento`.
Primero revisar y fusionar H14. Hasta entonces, el PR de H15 hacia develop incluye también los commits pendientes de H14; puede mantenerse en borrador indicando la dependencia. Si H14 se integra con squash o se modifica durante su revisión, revisar la base antes de marcar H15 lista; no fusionar H15 anticipadamente.

Título:

```text
feat(H15): generar y consultar alertas de reabastecimiento (#46)
```

Descripción:

```text
Relacionado con #46 — H15.
Depende de H14; revisar y fusionar H14 antes de integrar este PR.

Genera una sola alerta activa por insumo cuando el stock resultante de un
movimiento es menor o igual al mínimo. Mantiene la resolución auditada al
reabastecer y permite crear una nueva alerta ante otro período de agotamiento.
Todo ocurre dentro de la transacción del movimiento, con bloqueo por insumo.

Agrega GET /api/management/branches/:branchId/inventory/alerts, protegido
por sesión, rol y sucursal, con estado, historial y existencias actuales.
Reutiliza el esquema de H14 sin nuevas migraciones.

Validación: H15 20/20 en backend local y Docker; regresiones H10–H14,
unitarias e integración aprobadas. Datos persistentes conservados.
Postman preparado; no ejecutado con Postman/Newman.

Pendiente de revisión y aprobación por Christian.
```

Assignee: `Marceloereyes` (Assign yourself). Reviewer: `ChrMlg`. Vincular #46 desde Development y agregar el enlace del PR a la historia/card. La issue ya tiene labels `backend`, `epic-5-inventario`, `modulo-5`, `prisma`, `story` y milestone de la épica 5; al revisarla no figuraba un Project asociado. Agregar la historia al tablero del equipo si falta. Mantener In progress/en revisión mientras estén pendientes la aprobación y el merge; no marcar Done todavía.
