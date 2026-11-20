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

Para comprobar el arranque sin Postman: `curl -i http://127.0.0.1:3000/api/health`. Debe responder `200` y `{"status":"ok"}`. No requiere login ni credenciales. En Postman, la petición **Salud e inicio de ejecución** también funciona sin importar el environment, con el puerto predeterminado 3000. Si cambiaste `API_PORT`, usa ese puerto o importa el environment generado.

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

Si el healthcheck falla, revisar `docker compose --env-file .env.compose.local ps` y `npm run logs`. Un error de conexión indica que no se alcanzó la API; un `404` requiere comprobar que la URL termina en `/api/health`. Si funciona con curl pero falla en Postman web, seleccionar Desktop Agent y revisar el `baseUrl` activo. Un contenedor PostgreSQL iniciado no garantiza que el backend esté listo: `npm start` espera la salud de ambos.

Documentación de entrega: [README](README.md). Swagger local: `http://127.0.0.1:3000/api/docs`. Semilla de evaluación: `npm run seed:evaluation`; acceso del cliente en el archivo privado `ACCESO_CLIENTE_EVALUACION.md`.
