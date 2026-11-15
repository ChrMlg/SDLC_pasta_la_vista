# Backend: arranque, accesos y Postman

## Requisitos y arranque

Instalar Node.js 22 o superior, npm y Docker con Compose. Docker debe estar iniciado. Desde la raíz del repositorio:

```bash
git switch develop
git pull --ff-only origin develop
npm ci
npm start
```

`npm start` construye y levanta el backend y PostgreSQL, espera que estén saludables, aplica las migraciones de Prisma y prepara las cuentas iniciales del personal. No levanta el frontend. La primera ejecución necesita conexión para descargar dependencias e imágenes.

La API queda en `http://127.0.0.1:3000/api`. Para comprobarla:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

El proyecto usa una sola base de aplicación, `bistro`, en un único servicio PostgreSQL. `postgres`, `template0` y `template1` son bases administrativas de PostgreSQL, no bases adicionales de la aplicación. El nombre de Compose `sdlc-h10` se conserva para reutilizar el volumen existente. No se usa Supabase ni se crea una base separada de pruebas.

La configuración privada `.env.compose.local` se genera en instalaciones nuevas; `backend/.env` se deriva de ella. Conservarla si ya existe un volumen: contiene su conexión y la clave de los accesos iniciales. No copiar la configuración de otro equipo sobre un volumen existente. Los puertos predeterminados son 3000 para la API y 55440 para PostgreSQL; se pueden ajustar en `.env.compose.local` antes de volver a ejecutar `npm start`.

## Credenciales

Al terminar el arranque, abrir `ACCESOS_LOCALES.md`: contiene este procedimiento y los correos, contraseñas y sucursales verificados de esta instalación. Es un archivo privado, excluido de Git; se puede compartir directamente con el equipo que utiliza esa misma instalación.

Cada integrante que levanta su propio PostgreSQL obtiene sus propios accesos. No necesita recibir el `.env` de Marcelo. Se preparan cuentas WAITER, KITCHEN, MANAGER y GENERAL_MANAGER. Los clientes se registran mediante la API; el arranque no crea clientes, platos ni pedidos de demostración. Las cuentas y datos anteriores se conservan.

`backend/scripts/export-team-access.cjs` verifica los inicios de sesión y genera el documento privado y el environment de Postman. No crea bases ni cambia contraseñas. `npm start` lo ejecuta automáticamente. Si una cuenta inicial fue modificada, el exportador avisa y no restablece sus credenciales.

## Postman

1. Importar `postman/SDLC-Backend.postman_collection.json`.
2. Importar `postman/SDLC.postman_environment.json`, generado por el arranque local.
3. Seleccionar el environment **SDLC — Backend local**.
4. Abrir Collection Runner, seleccionar todas las carpetas y ejecutarlas en su orden original, desde `00`.

La colección registra clientes, inicia sesión por rol y captura los identificadores necesarios para los pasos siguientes. No introducir IDs manualmente ni ejecutar pasos dependientes antes de los anteriores. Usa autenticación por cookies: mantener habilitado el almacenamiento de cookies de Postman. Si se utiliza Postman web, seleccionar Desktop Agent para acceder al backend local.

La ejecución manual crea operaciones persistentes en la base del proyecto. Necesita una mesa disponible y puede dejarla en estado NEEDS_CLEANING al cerrar la cuenta, según las reglas del negocio. Revisar las aserciones del runner: los casos etiquetados como **400 esperado**, 409 o 401 verifican rechazos intencionales; esos códigos no indican por sí solos que la colección falló.

Para probar manualmente un login, usar `POST /api/auth/login` con JSON `email` y `password` tomados del documento privado. Para registrar un cliente, usar `POST /api/auth/register/customer` con `email`, `password`, `firstName`, `lastName` y `phone` de ocho dígitos. Usar los valores que genera la colección evita campos incompletos y correos repetidos.

Si aparece una variable sin resolver, importar y seleccionar el environment generado en esa misma instalación. Si una petición válida devuelve 400, revisar su respuesta y sus campos; no atribuirlo automáticamente a Prisma. Si no hay conexión, comprobar el health y los logs.

## Verificación reproducible sin dejar operaciones

Con el backend iniciado:

```bash
npm run verify:postman
```

Ejecuta la misma colección mediante Newman en `bistro`, con cuentas y sucursales temporales identificadas. Al terminar elimina solamente los registros de esa ejecución; no crea otra base ni borra los datos del equipo. La validación de esta entrega completó 116 solicitudes y 149 aserciones sin fallos. Esperar a que termine para que complete la limpieza.

## Detener y consultar

```bash
npm stop
npm logs
```

`npm stop` detiene los servicios conservando los datos. `npm logs` muestra los mensajes del backend. Para consultar los contenedores del proyecto:

```bash
docker compose --env-file .env.compose.local ps
```

No eliminar el volumen ni ejecutar `down -v` si se desea conservar la información.
