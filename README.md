# Pasta la Vista

Backend del sistema de restaurantes con sucursales: catálogo, pedidos, cocina, reservaciones, inventario, pagos, lealtad, reseñas, notificaciones y reportes.

**Curso:** Ingeniería de Software, UCA, ciclo 02/2026. Sección y número oficial de proyecto: pendientes de confirmación del equipo.

## Ambiente desplegado

Swagger público: pendiente. Preparamos el backend en Railway (imagen Docker) y PostgreSQL en Supabase; faltan proyecto, variables, dominio público y publicación. Este repositorio y el alcance confirmado contienen solo backend. El formato exige también frontend público: ese requisito sigue pendiente.

Las credenciales de evaluación se entregan en Moodle, nunca en Git.

## Integrantes

| Integrante | GitHub | Alcance según issues |
|---|---|---|
| Marcelo Enrique Campos Reyes | Marceloereyes | Catálogo, cocina, reservas, inventario, reseñas y reportes; detalle en historias |
| Christian | ChrMlg | Pedidos, pagos y notificaciones; detalle en historias |
| Diego | DiegoJacob0 | H19 y H20 |

Carnets y nombres completos restantes: pendientes de confirmación del equipo.

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
