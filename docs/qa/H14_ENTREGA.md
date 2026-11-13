# Entrega H14 — Movimientos manuales de inventario

Fecha: 2026-11-13. Historia [#45](https://github.com/ChrMlg/SDLC_pasta_la_vista/issues/45). Rama `feature/H14-movimientos-inventario`, basada en develop corregido (`98dc732`). H10–H13 ya se encuentran integradas, por lo que el diff de esta rama contiene la entrega H14 y sus herramientas locales.

## Corrección previa ya subida a develop

`98dc732 — fix(H10-H13): completar arranque local con Docker Compose`.

Después de los merges faltaba completar y comprobar el requisito de la cátedra: backend y PostgreSQL local con Compose. La corrección incorpora arranque automático, healthchecks, inicialización idempotente de mesas/insumos y persistencia del volumen. Se publicó directamente a develop por instrucción del responsable. Detalles: [CORRECCION_H10_H13_DOCKER.md](CORRECCION_H10_H13_DOCKER.md).

## Qué entrega H14

- Movimiento manual validado y auditado; permisos por rol y sucursal.
- Bloqueo por insumo y transacción para impedir stock negativo y resolver alertas al superar el mínimo.
- Migración de movimientos y persistencia de alertas requerida por H14. Generación/consulta de alertas pendiente de H15.
- Herramientas de datos y accesos que usan únicamente PostgreSQL local de Docker, sin secretos en código ni cambios de contraseñas existentes.
- Pruebas reales, colección Postman y evidencia local.

Validación: H14 21, unitarias 25, H10 28, H11 23, H12 18, H13 17 y 108 comprobaciones HTTP existentes aprobadas. Otras 30 comprobaciones se ejecutaron contra el backend real del contenedor. Las 14 migraciones locales están aplicadas, sin diferencias contra el esquema. Postman preparado y validado sintácticamente; no ejecutado con Postman/Newman.

## Arranque único

Con Docker iniciado y Node 22 o superior, desde la raíz:

```bash
npm start
```

Construye el Dockerfile y levanta solo backend y PostgreSQL local; aplica migraciones, completa datos faltantes y espera ambos servicios saludables. API `http://127.0.0.1:3000/api`. `npm stop` detiene sin eliminar el volumen; `npm run logs` muestra el backend. Frontend queda fuera del arranque habitual.

Se reutilizan el proyecto Compose y volumen existentes. Las credenciales y el nombre técnico de esa base no se cambian para evitar pérdida de datos. La configuración remota anterior permanece respaldada en privado, sin conexiones ni escrituras nuevas. No se publicó una web.

Los correos y contraseñas del seed están en `.env.project.credentials`; el texto del equipo es `accesos-equipo-privado.txt`, ignorado por Git. Importar `postman/.env.project.local` para pruebas manuales, sin subirlo al repositorio.

## Commit y PR H14

Título del commit y PR:

```text
feat(H14): registrar movimientos de inventario (#45)
```

Razón del commit:

```text
Registra entradas y salidas auditadas, evita stock negativo mediante bloqueo por insumo y resuelve alertas en una transaccion. Integra la historia sobre develop corregido y verifica su funcionamiento con PostgreSQL local y el backend de Docker. Conserva datos y credenciales privadas.
```

Base del PR: `develop`. Compare: `feature/H14-movimientos-inventario`. Assignee: Marceloereyes. Reviewer: ChrMlg.

Descripción lista para copiar:

```text
Relacionado con #45 — H14.

Registra entradas y salidas manuales de inventario, valida cantidad/motivo/permisos
por sucursal y deriva el actor de la sesión. Usa bloqueo por insumo y una transacción
para actualizar stock, guardar el movimiento y resolver alertas al superar el mínimo.

Incluye InventoryAlert para la resolución exigida por H14; su generación y consulta
corresponden a H15. Se ejecuta con PostgreSQL local y el backend de Docker Compose.

Base: develop actualizado después de los merges H10–H13 y la corrección 98dc732.
Pruebas: H14 y regresiones aprobadas; 25 unitarias, 108 comprobaciones HTTP existentes
y 30 verificaciones contra la API real de Docker. Migraciones locales actualizadas.
Postman preparado; no ejecutado con Postman/Newman.

Pendiente de revisión por Christian. No hacer merge antes de su aprobación.
```

Vincular el PR a #45 desde Development y copiar su enlace al tablero. Marcar criterios backend verificados; mantener pendiente aprobación y merge. Card en revisión o In progress, no Done todavía. H14 no se fusiona automáticamente.

Los cambios locales anteriores de QA remota se conservaron en `.respaldo-local/qa-anterior`, ignorado por Git y Docker. No se ejecutan ni se incluyen en esta entrega. El trabajo anterior completo también permanece respaldado en el stash creado antes de actualizar develop. Las copias de trabajo antiguas de H10–H13 se conservaron sin reescribir su historial.
