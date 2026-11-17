# Despliegue del backend en DigitalOcean

## Estado real

Plataforma elegida: DigitalOcean. Aún no se proporcionaron servidor, dominio ni URL del frontend. Se preparó la opción Droplet con Docker Compose; no se creó infraestructura ni se ejecutó despliegue. Si el equipo elige App Platform, debe adaptar la configuración antes de publicar.

Este repositorio contiene el backend. La publicación y las capturas del frontend corresponden a su responsable. No se encontró una URL pública configurada en develop ni release v1.0.0 al revisar el 17/11/2026.

## Preparación del Droplet

1. Disponer de un Droplet con Docker Engine, Compose y Git. Registrar un dominio real de API y apuntar su DNS al servidor.
2. Permitir HTTPS/HTTP (443 y 80) y SSH para administración. PostgreSQL y el backend no publican sus puertos; solo Caddy queda expuesto.
3. Completar el Git Flow: release/1.0.0 desde develop, PR a main aprobado por otro integrante, retorno a develop y etiqueta v1.0.0. Clonar en el servidor y seleccionar ese tag de main. No publicar develop como entrega final.
4. Desde la raíz, ejecutar `node backend/scripts/prepare-production.cjs DOMINIO_REAL_DE_API`. Crea `deploy/digitalocean/.env.production` con claves aleatorias sin imprimirlas ni sobrescribir un archivo existente. Requiere Node.js 22 para esta preparación; los servicios corren dentro de Docker.
5. Configurar `CORS_ORIGINS` con la URL HTTPS exacta del frontend cuando el equipo la confirme. No usar `*` con cookies. Conservar el archivo privado y los volúmenes.

## Arranque

Desde la raíz del repositorio en el servidor:

```bash
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml up -d --build --wait
```

Son tres servicios: backend, **un PostgreSQL** con la base `bistro` y Caddy para HTTPS. El tercero no es otra base. La base de producción es persistente en el servidor; no se copia ni se borra la base local.

Caddy obtiene y renueva el certificado cuando el dominio público apunta al servidor y 80/443 son accesibles. Comprobar `https://DOMINIO_REAL_DE_API/api/health` y `/api/docs`; una validación de Compose local no demuestra que HTTPS público funcione.

## Usuarios y datos de evaluación

Después de las migraciones y el bootstrap automáticos:

```bash
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml exec backend node scripts/seed-evaluation.cjs --configured
```

Usa la misma semilla que `npm run seed:evaluation` en local. Prepara personal, cliente, menú, reservas, inventario, cocina, pagos simulados, comprobantes, reseñas y ventas. No restablece ejemplos ya modificados. Ejecutar una sola semilla a la vez. Lealtad H19–H22 no está implementada en este checkout y depende de sus responsables.

El cliente se exporta a `/app/ACCESO_CLIENTE_EVALUACION.md` dentro del contenedor. Para exportar personal verificado, ejecutar:

```bash
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml exec backend node scripts/export-team-access.cjs --configured
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml cp backend:/app/ACCESOS_LOCALES.md ./ACCESOS_PRODUCCION.md
docker compose --env-file deploy/digitalocean/.env.production -f deploy/digitalocean/compose.yaml cp backend:/app/ACCESO_CLIENTE_EVALUACION.md ./ACCESO_CLIENTE_EVALUACION.md
```

Los archivos exportados son privados y están excluidos de Git. Entregar esas credenciales en Moodle; nunca copiar las credenciales locales como si fueran las de producción.

## Variables privadas

| Variable | Uso |
|---|---|
| API_DOMAIN | Dominio público de la API |
| POSTGRES_PASSWORD | Clave del PostgreSQL de producción |
| LOCAL_ACCESS_KEY | Clave estable para personal y cliente de evaluación |
| CORS_ORIGINS | Orígenes exactos del frontend, separados por coma |
| DATABASE_URL, DIRECT_URL | Compose las deriva para Prisma |
| COOKIE_SECURE | true en producción |

Si frontend y API están en dominios de sitios distintos, falta validar la política SameSite y CSRF antes de habilitar acceso cruzado. Preferir subdominios del mismo sitio o proxy de API. No cambiar la política a ciegas sin conocer el frontend.

## Verificación de entrega

Validar todos los roles desde el frontend desplegado, Swagger y las historias asignadas. Entregar URLs y usuarios en Moodle antes del 20/11 a las 23:59. Mantener servicio, volumen y usuarios al menos hasta el 24/11. Registrar aceptación por otro integrante el 21–22/11 y compartir el plan según la guía. No marcar como completados estos pasos por haber pasado pruebas locales.

Referencias: [DigitalOcean: conexión SSH](https://docs.digitalocean.com/products/droplets/how-to/connect-with-ssh/), [DNS](https://docs.digitalocean.com/products/networking/dns/how-to/add-domains/), [Caddy: HTTPS automático](https://caddyserver.com/docs/automatic-https).
