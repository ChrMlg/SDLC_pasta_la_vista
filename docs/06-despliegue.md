# Despliegue: DigitalOcean y Supabase

## Estado y alcance

Preparamos el **backend** para un Droplet de DigitalOcean con Docker Compose y Caddy; PostgreSQL se aloja en Supabase. No se han creado recursos externos ni verificado un dominio público. Este repositorio no tiene frontend. La guía de entrega exige frontend público y flujos desde navegador: falta cubrir ese requisito o confirmar una excepción con la cátedra. Swagger no sustituye el frontend.

El formato permite elegir plataforma; menciona Supabase y Neon como opciones. Elegimos Supabase para los datos y DigitalOcean para la API. El PostgreSQL de Compose raíz se conserva exclusivamente para desarrollo local.

## Preparar Supabase

1. Crear un proyecto dedicado al ambiente de evaluación. Guardar sus credenciales de base en un gestor privado. No necesitamos claves `anon`/`service_role` ni Supabase Auth: NestJS mantiene las sesiones y permisos.
2. Desactivar **Data API** en la configuración API de Supabase: este proyecto accede mediante Prisma y sus tablas no implementan políticas RLS para acceso directo desde clientes. La única API pública será NestJS. [Referencia oficial](https://supabase.com/docs/guides/database/prisma).
3. En **Connect**, copiar la URI de **Session pooler**, puerto **5432**. Funciona por IPv4 y sirve para la aplicación y las migraciones. Usar ese mismo destino en `DATABASE_URL` y `DIRECT_URL`; incluir `sslmode=require`, `schema=public` y, para limitar conexiones de una instancia, `connection_limit=5`. Codificar los caracteres especiales de la contraseña como componente URL. No inventar el hostname ni el identificador del proyecto.
4. Alternativa: conexión directa si el Droplet tiene conectividad IPv6 al destino. Si se elige Transaction pooler (6543) para `DATABASE_URL`, Prisma 5 necesita `pgbouncer=true`; `DIRECT_URL` debe seguir usando conexión directa o Session pooler, nunca Transaction pooler. [Conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
5. Usar un esquema de aplicación vacío para la primera instalación. Las migraciones crean tablas, restricciones y datos iniciales; la semilla agrega ejemplos de evaluación. No hace falta subir un dump de la base local. Si existen datos reales que deban trasladarse, realizar una migración de datos planificada con respaldo antes de publicar; no ejecutar `migrate reset`, `db push --accept-data-loss` ni importar encima de tablas existentes.

La integración conserva Prisma 5 y `directUrl` en `schema.prisma`; no copiar la configuración de Prisma 7 de ejemplos recientes sin una migración de dependencias.

## Preparar el Droplet y la versión

1. Disponer de Docker Engine, Compose, Git y Node.js 22. Apuntar un dominio de API al Droplet mediante DNS. Abrir 80/443; restringir SSH a los administradores. No exponer 3000 ni 5432.
2. Completar los cambios en `develop` por PR revisados. Crear `release/1.0.0`, fijar la versión y abrir PR hacia `main` aprobado por otro integrante. Integrar el retorno a `develop`; etiquetar el commit de `main` como `v1.0.0` y publicar sus notas. Estos pasos no se han ejecutado automáticamente.
3. Clonar el repositorio privado en el servidor con acceso de lectura y seleccionar el tag verificado de `main`. El código desplegado debe coincidir exactamente con esa versión. Mantener el checkout sin ediciones de código.
4. Desde la raíz:

```bash
node backend/scripts/prepare-production.cjs DOMINIO_REAL_DE_API
```

Se crea `deploy/digitalocean/.env.production` con permisos privados y una clave de accesos aleatoria. Completar allí `DATABASE_URL` y `DIRECT_URL`, entre comillas simples para que Compose no interpole caracteres `$`. No publicar ni pegar el archivo en logs. El generador se niega a sobrescribir configuraciones existentes.

```bash
node backend/scripts/prepare-production.cjs --check
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml config --quiet
```

La comprobación valida formato, TLS, cookies, orígenes y modo del pooler; no comprueba conectividad. Si se conserva una configuración anterior con `POSTGRES_PASSWORD`, agregar las dos URI de Supabase y conservar `LOCAL_ACCESS_KEY`. No elimina ni migra un volumen de producción antiguo.

## Arrancar

```bash
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml up -d --build --wait
```

Son dos contenedores: backend y Caddy. El backend valida la configuración, aplica `prisma migrate deploy`, ejecuta bootstrap y escucha. Supabase es la única base de producción. Las cuentas demo históricas de las migraciones quedan deshabilitadas; los accesos entregables se generan con la clave privada.

Caddy obtiene el certificado con DNS correcto y puertos 80/443 accesibles. Conservamos sus volúmenes para renovarlo. [HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).

Comprobar desde otro equipo, sin omitir la validación TLS:

```bash
curl --fail --show-error https://DOMINIO_REAL_DE_API/api/health
curl --fail --show-error https://DOMINIO_REAL_DE_API/api/docs-json
```

Abrir además `/api/docs` en navegador. El healthcheck consulta PostgreSQL; se espera HTTP 200 y `{"status":"ok"}`. Un contenedor healthy en local no acredita HTTPS público.

## Usuarios y semilla de evaluación

Después del arranque, ejecutar una sola vez a la vez:

```bash
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml exec backend node scripts/seed-evaluation.cjs --configured
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml exec backend node scripts/export-team-access.cjs --configured
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml cp backend:/app/ACCESOS_LOCALES.md ./ACCESOS_PRODUCCION.md
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml cp backend:/app/ACCESO_CLIENTE_EVALUACION.md ./ACCESO_CLIENTE_EVALUACION.md
chmod 600 ACCESOS_PRODUCCION.md ACCESO_CLIENTE_EVALUACION.md
```

Es la misma semilla que `npm run seed:evaluation` en local. Prepara los cinco roles, sucursales, menú, reservas, inventario, cocina, pagos simulados, comprobantes, reseñas y ventas. También crea la regla y un beneficio de lealtad, un pago que genera puntos y una cuenta abierta para canje. Conserva ejemplos y configuraciones ya modificados; no repone puntos gastados ni reactiva beneficios desactivados. Si cambió la regla, el saldo acumulado depende de esa regla.

Los archivos exportados son privados y están excluidos de Git. Verificar el login del cliente y del personal desde el dominio público. Entregar las credenciales de producción en Moodle, no las locales. Conservar `LOCAL_ACCESS_KEY`, la base y las mismas cuentas al menos hasta el **24 de noviembre de 2026**. Las regresiones y Newman automatizados escriben fixtures y están restringidos a la base local; no ejecutarlos contra producción.

## Variables de producción

| Variable | Uso |
|---|---|
| API_DOMAIN | Dominio público sin protocolo ni ruta |
| DATABASE_URL | URI TLS de Supabase para Prisma Client |
| DIRECT_URL | URI TLS al mismo proyecto para migraciones; directa o Session pooler |
| LOCAL_ACCESS_KEY | Clave hexadecimal privada estable de 64 caracteres para los accesos |
| LOCAL_ACCESS_VERSION | 2, fijada en Compose |
| PUBLIC_API_URL | Compose construye `https://API_DOMAIN/api` |
| CORS_ORIGINS | Vacío para Swagger del mismo origen; si hay frontend, sus orígenes HTTPS exactos separados por coma |
| COOKIE_SECURE | true, fijado en Compose |
| DISABLE_LEGACY_DEMO | true en producción; deshabilita únicamente las cuentas demo históricas conocidas |
| PORT | 3000 interno, sin publicación directa |

No se usa JWT: la autenticación es una sesión opaca con cookie HttpOnly y SameSite=Lax. Un frontend futuro debe usar el mismo sitio (por ejemplo, subdominios del mismo dominio) y enviar credenciales. Un sitio distinto requiere revisar cookies y protección CSRF antes de habilitarlo.

## Actualizar, respaldo y aceptación

Antes de cada actualización, respaldar Supabase mediante sus mecanismos disponibles o un `pg_dump` privado. Revisar las migraciones y conservar la configuración privada. Desplegar el nuevo tag de `main` con el mismo comando de Compose. Repetir salud, Swagger, logins y flujos; cambiar solo la imagen no revierte una migración incompatible. No borrar volúmenes para reparar errores.

Una corrección posterior a publicar sigue `hotfix/<descripcion>` desde `main`, PR revisados hacia `main` y `develop`, y versión `v1.0.1`. Registrar el SHA desplegado, la fecha y las URLs reales en README y API.

Entrega final: **20/11/2026, 23:59**, hora de El Salvador. Plan ejecutado: **22/11/2026, 23:59**. Ejecutar la aceptación desplegada el 21–22 y mantener el sistema activo hasta el 24.
