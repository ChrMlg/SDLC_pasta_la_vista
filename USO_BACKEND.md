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

- `npm logs`: consultar errores del backend.
- `npm stop`: detener los servicios conservando los datos.
- `npm start`: volver a levantar los servicios y regenerar los accesos y el environment.
