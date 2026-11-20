# Despliegue: Railway y Supabase

## Estado y alcance

El equipo informó el 20/11/2026 que el backend está desplegado en Railway con PostgreSQL en Supabase y que las rutas responden en Postman.

- Servicio: https://practical-transformation-staging.up.railway.app/
- API: https://practical-transformation-staging.up.railway.app/api
- Healthcheck: https://practical-transformation-staging.up.railway.app/api/health
- Swagger: https://practical-transformation-staging.up.railway.app/api/docs

Para la entrega, cotejar el SHA del deployment con el commit de `main` etiquetado `v1.0.0`. El frontend se mantiene en otro alcance y su documentación corresponde al equipo responsable.

Docker Compose raíz mantiene la base local. En producción Railway ejecuta una imagen del backend; no se crea una segunda base en Railway.

## Preparar Supabase

1. Crear un proyecto dedicado al ambiente de evaluación. Guardar sus credenciales de base en un gestor privado. No necesitamos claves `anon`/`service_role` ni Supabase Auth: NestJS mantiene las sesiones y permisos.
2. Desactivar **Data API** en la configuración API de Supabase: este proyecto accede mediante Prisma y sus tablas no implementan políticas RLS para acceso directo desde clientes. La única API pública será NestJS. [Referencia oficial](https://supabase.com/docs/guides/database/prisma).
3. En **Connect**, copiar la URI de **Session pooler**, puerto **5432**. Funciona por IPv4 y sirve para la aplicación y las migraciones. Usar ese mismo destino en `DATABASE_URL` y `DIRECT_URL`; incluir `sslmode=require`, `schema=public` y, para limitar conexiones de una instancia, `connection_limit=5`. Codificar los caracteres especiales de la contraseña como componente URL. No inventar el hostname ni el identificador del proyecto.
4. Alternativa: conexión directa si el servicio tiene conectividad IPv6 al destino. Si se elige Transaction pooler (6543) para `DATABASE_URL`, Prisma 5 necesita `pgbouncer=true`; `DIRECT_URL` debe seguir usando conexión directa o Session pooler, nunca Transaction pooler. [Conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
5. Usar un esquema de aplicación vacío para la primera instalación. Las migraciones crean tablas, restricciones y datos iniciales; la semilla agrega ejemplos de evaluación. No hace falta subir un dump de la base local. Si existen datos reales que deban trasladarse, realizar una migración de datos planificada con respaldo antes de publicar; no ejecutar `migrate reset`, `db push --accept-data-loss` ni importar encima de tablas existentes.

La integración conserva Prisma 5 y `directUrl` en `schema.prisma`; no copiar la configuración de Prisma 7 de ejemplos recientes sin una migración de dependencias.

## Configuración del servicio Railway

**Publicación de la versión:** la rama `bugfix/H1-H35-preparacion-railway` debe entrar a `develop` mediante PR aprobado. Luego crear `release/1.0.0` desde `develop`, realizar los ajustes finales, fusionar a `main` por PR aprobado, regresar la release a `develop` y crear `v1.0.0` en el commit publicado de `main`. Esta documentación se preparó a partir del commit `c3720b7`; comprobar los cambios más recientes antes de abrir el PR y al publicar en `main`. Antes de cambiar Railway a la rama `main`, verificar que la release ya fue fusionada. No basta con volver a desplegar una imagen antigua.

Mantener el servicio existente en Railway y revisar estos ajustes al cambiar la rama de despliegue:

| Ajuste | Valor |
|---|---|
| Rama de producción | main, con release aprobada |
| Root Directory | `/` (raíz del repositorio) |
| Variable RAILWAY_DOCKERFILE_PATH | `backend/Dockerfile` |
| Start Command | `sh scripts/start-production.sh` |
| Healthcheck Path | `/api/health` |
| Healthcheck Timeout | 300 segundos inicialmente |
| Réplicas | 1 inicialmente |

El Dockerfile usa los manifiestos npm de la raíz: no establecer `/backend` como Root Directory. No usar `npm start` de la raíz, que levanta Docker Compose local. El comando de producción valida variables, aplica migraciones, ejecuta bootstrap y arranca NestJS. Si un paso falla, el proceso termina antes de escuchar.

Railway admite indicar el Dockerfile mediante `RAILWAY_DOCKERFILE_PATH`. [Dockerfiles en Railway](https://docs.railway.com/builds/dockerfiles).

Generar un dominio público del servicio y usarlo en PUBLIC_API_URL. El backend escucha en `0.0.0.0` y en el `PORT` del entorno. Configurar el puerto de destino del dominio para que coincida con PORT. El healthcheck consulta PostgreSQL y debe devolver 200 antes de considerar exitoso el despliegue. [Healthchecks en Railway](https://docs.railway.com/deployments/healthchecks).

## Variables privadas

Completar las variables en Railway; `deploy/railway/.env.example` documenta los nombres. Las conexiones apuntan al mismo proyecto Supabase.

| Variable | Uso |
|---|---|
| DATABASE_URL | URI TLS para Prisma Client |
| DIRECT_URL | URI TLS directa o Session pooler 5432 para migraciones |
| LOCAL_ACCESS_KEY | Clave hexadecimal privada estable de 64 caracteres |
| LOCAL_ACCESS_VERSION | 2 para una instalación nueva; conservar la existente |
| PUBLIC_API_URL | `https://DOMINIO_REAL/api` |
| COOKIE_SECURE | true |
| CORS_ORIGINS | Vacío para Swagger; orígenes HTTPS exactos si hay frontend |
| RAILWAY_DOCKERFILE_PATH | backend/Dockerfile |
| PORT | Puerto suministrado/configurado en Railway; debe coincidir con el dominio |
| DISABLE_LEGACY_DEMO | El script de producción fija true para deshabilitar cuentas demo históricas |

Se puede generar una plantilla privada local, sin sobrescribir claves existentes:

```bash
node backend/scripts/prepare-production.cjs DOMINIO_REAL_DE_RAILWAY
# Completar DATABASE_URL y DIRECT_URL en deploy/railway/.env.production.
node backend/scripts/prepare-production.cjs --check
```

Transferir los valores al panel Variables de Railway mediante una sesión privada. No subir ese archivo al repositorio ni copiarlo a capturas o logs. La validación comprueba formato, no conectividad ni la existencia del dominio.

La sesión usa cookie HttpOnly y SameSite=Lax, no JWT. Un frontend futuro debe usar el mismo sitio y enviar credenciales; un sitio distinto requiere revisar cookies y CSRF antes de habilitarlo.

## Semilla y accesos

Si faltan datos de evaluación en Supabase, comprobar antes los registros existentes y, solo cuando corresponda, conectarse por SSH al servicio Railway mediante la CLI autenticada. Dentro del contenedor, trabajar en `/app/backend`. [CLI y SSH de Railway](https://docs.railway.com/cli).

```bash
node scripts/seed-evaluation.cjs --configured
node scripts/export-team-access.cjs --configured
```

No usar `railway run` como equivalente de SSH: ejecuta procesos en la máquina local con variables remotas. La semilla es la misma de `npm run seed:evaluation` en local; prepara los cinco roles, menú, reservas, inventario, cocina, pagos, comprobantes, reseñas, reportes y lealtad con una cuenta abierta para canje. Ejecutar en serie; conserva ejemplos modificados y no repone puntos gastados.

Los accesos quedan en `/app/ACCESOS_LOCALES.md` y `/app/ACCESO_CLIENTE_EVALUACION.md` dentro del contenedor. Recuperarlos mediante la sesión privada y guardarlos fuera del repositorio; no imprimirlos en logs de despliegue. Los archivos del contenedor son temporales, pero las cuentas están en Supabase: conservar LOCAL_ACCESS_KEY y LOCAL_ACCESS_VERSION permite exportar los mismos accesos después de redesplegar. Verificar cada rol desde el dominio público y entregar credenciales solamente en Moodle.

## Comprobar y actualizar

```bash
curl --fail --show-error https://DOMINIO_REAL/api/health
curl --fail --show-error https://DOMINIO_REAL/api/docs-json
```

Abrir `/api/docs` desde otro equipo, iniciar sesión y recorrer las historias. Registrar URLs reales en README y API; completar capturas de uso y aceptación. No ejecutar runners de fixtures contra producción.

Antes de actualizar, respaldar Supabase y revisar migraciones. Publicar un nuevo commit/tag revisado de main y comprobar qué SHA desplegó Railway. Una reversión de imagen no revierte migraciones incompatibles. Para correcciones posteriores a publicar: hotfix desde main, revisión hacia main/develop y versión v1.0.1.

Entrega final: 20/11/2026 a las 23:59; plan ejecutado: 22/11/2026 a las 23:59; mantener servicio y usuarios hasta el 24/11, hora de El Salvador. Las pruebas locales no acreditan HTTPS ni aceptación desplegada.
