# Bistro

Backend del sistema de restaurantes con sucursales: catálogo, pedidos, cocina, reservaciones, inventario, pagos, lealtad, reseñas, notificaciones y reportes.

**Curso:** Ingeniería de Software, UCA, ciclo 02/2026. Sección y número oficial de proyecto: pendientes de confirmación del equipo.

## Backend desplegado

**API (Railway):** https://practical-transformation-staging.up.railway.app/api
**Healthcheck:** https://practical-transformation-staging.up.railway.app/api/health
**Swagger:** https://practical-transformation-staging.up.railway.app/api/docs

El equipo informó el 20/11/2026 que el backend está desplegado, conectado a PostgreSQL en Supabase, y que sus rutas responden en Postman. Este documento no acredita por sí mismo cada criterio de aceptación ni el commit exacto publicado en Railway: deben cotejarse con el deployment y los resultados de prueba. La interfaz frontend se gestiona fuera del alcance de este repositorio.

Para la entrega final, integrar los cambios de esta rama a `develop` mediante PR aprobado, publicar `release/1.0.0` en `main` mediante otro PR aprobado y crear la etiqueta `v1.0.0` sobre el commit publicado. **Railway debe desplegar ese mismo commit de `main`.** Véase [forma de trabajo](docs/07-forma-de-trabajo.md) y [despliegue](docs/06-despliegue.md).

Las credenciales de evaluación se entregan en Moodle, nunca en Git.

## Integrantes

| Integrante | GitHub | Alcance según issues |
|---|---|---|
| Marcelo Enrique Campos Reyes (00148023) | Marceloereyes | Módulos 3 (Cocina), 4 (Reservaciones), 5 (Inventario), 8 (Reseñas) y 10 (Reportes): H6–H15, H23–H25 y H31–H35 (18 historias). No incluye H1–H3. |
| Christian (00110219) | ChrMlg | Pedidos, pagos y notificaciones; detalle en historias |

## Inicio local

Con Node.js 22 y Docker Compose activos: `npm ci` y `npm start` desde la raíz. API: `http://127.0.0.1:3000/api`; Swagger: `/api/docs`. Accesos privados: `ACCESOS_LOCALES.md`. Procedimiento completo en instalación local.

## Documentación

1. [Guia de uso](docs/01-guia-de-uso.md)
2. [Arquitectura](docs/02-arquitectura.md)
3. [Modelo de datos](docs/03-modelo-de-datos.md)
4. [Api](docs/04-api.md)
5. [Instalacion local](docs/05-instalacion-local.md)
6. [Despliegue](docs/06-despliegue.md)
7. [Forma de trabajo](docs/07-forma-de-trabajo.md)
8. [Historias](docs/08-historias.md)
9. [Problemas conocidos](docs/09-problemas-conocidos.md)
