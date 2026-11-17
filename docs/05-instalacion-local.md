# Uso del backend

Requisitos: Node.js 22 o superior y Docker con Compose iniciado. Ejecutar desde la raíz:

```bash
git switch develop
git pull --ff-only origin develop
npm ci
npm start
```

El arranque levanta el backend y PostgreSQL, aplica las migraciones y conserva los datos en la base `bistro`. Genera la configuración y los accesos de cada instalación automáticamente. Conservar `.env.compose.local` y el volumen para mantener los datos.

API: `http://127.0.0.1:3000/api`. Comprobación: `GET /api/health`.

Comprobar sin credenciales: `curl -i http://127.0.0.1:3000/api/health`. Se espera `200` y `{"status":"ok"}`. La petición **Salud e inicio de ejecución** de Postman usa esta URL por defecto y no exige environment. Para las demás peticiones, importar los accesos de la instalación. Si se cambia `API_PORT`, usar ese puerto.

## Accesos

Consultar `ACCESOS_LOCALES.md`, generado por el arranque y excluido de Git. Contiene los correos, contraseñas y sucursales del personal de esa instalación. Los clientes se registran por la API.

Login: `POST /api/auth/login`, con JSON `email` y `password`.
Registro: `POST /api/auth/register/customer`, con `email`, `password`, `firstName`, `lastName` y `phone` de ocho dígitos.

## Postman

1. Importar `postman/SDLC-Backend.postman_collection.json`.
2. Importar `postman/SDLC.postman_environment.json`, generado por `npm start`.
3. Seleccionar **SDLC — Backend local**.
4. Ejecutar todas las carpetas en orden desde `00` con Collection Runner. Mantener habilitadas las cookies; en Postman web, usar Desktop Agent.

La colección completa los IDs automáticamente. Las solicitudes con errores esperados validan rechazos: revisar sus aserciones. La ejecución manual guarda operaciones y necesita una mesa disponible; al cerrar su cuenta puede quedar en NEEDS_CLEANING.

Para verificar sin dejar operaciones, ejecutar `npm run verify:postman`: usa la misma base y elimina únicamente los registros temporales de esa ejecución.

## Comandos útiles

- `npm run logs`: consultar errores del backend.
- `npm stop`: detener los servicios conservando los datos.
- `npm start`: volver a levantar los servicios y regenerar los accesos y el environment.

## Docker Compose y credenciales

`npm start` ejecuta `backend/scripts/local-stack.cjs`: crea `.env.compose.local` si la instalación es nueva, genera LOCAL_ACCESS_KEY aleatoriamente y llama a Docker Compose. `backend/prisma/initial-accounts.cjs` deriva accesos estables con HMAC; `bootstrap.cjs` inserta el personal sin sobrescribir cuentas y almacena hashes scrypt. `export-team-access.cjs` verifica los logins y escribe los dos archivos privados.

Después de preparar la configuración puede usarse `docker compose --env-file .env.compose.local up -d --build --wait db backend`; luego `node backend/scripts/export-team-access.cjs` regenera los archivos de acceso.

Importar únicamente la colección **SDLC — Colección completa del backend** y el environment **SDLC — Backend local**. Las capturas con **SDLC QA privado** y **SDLC Backend — Integration Tests** corresponden a archivos anteriores; no editarlos ni reutilizarlos para esta versión. Conservar cambios locales antes de actualizar una copia del repositorio.

## Variables

| Variable | Uso |
|---|---|
| DATABASE_URL, DIRECT_URL | Conexión Prisma; generada localmente |
| POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD | Configuración privada de Compose |
| API_PORT, DB_PORT | Puertos locales |
| LOCAL_ACCESS_KEY, LOCAL_ACCESS_VERSION | Identidad estable de las cuentas iniciales |
| COOKIE_SECURE | true cuando se sirve con HTTPS |
| CORS_ORIGINS | Orígenes permitidos del frontend, separados por coma |

`npm test` ejecuta Jest y las pruebas unitarias previas. `npm run verify:postman` ejecuta la colección con limpieza de sus registros. Las pruebas HTTP automatizadas no sustituyen las pruebas manuales de la guía de cátedra.

## Semilla para evaluación

`npm run seed:evaluation` agrega personal, un cliente, dos platillos por sucursal, cuatro pedidos con pagos simulados y comprobantes, una reseña, una reserva y un movimiento de inventario. Conserva los datos existentes y reutiliza los ejemplos al repetir el comando. Exporta el cliente a `ACCESO_CLIENTE_EVALUACION.md` privado. En producción usar el mismo comando con `-- --configured` y las variables del entorno; ejecutar después de migraciones y bootstrap. Incluye ventas de las tres sucursales para consultar reportes y una comanda pendiente en Centro. Lealtad H19–H22 sigue pendiente de integración por sus responsables. Ejecutar una sola instancia del seed a la vez.

Regresiones HTTP por historia: `npm run test:stories`. Se ejecutan en serie sobre la base local con fixtures propios y limpieza. No ejecutar semillas ni otros runners simultáneamente: las transacciones serializables pueden rechazar operaciones competidoras con 409.
