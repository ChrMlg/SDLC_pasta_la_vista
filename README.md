# Bistro

**Bistro** es el backend de un sistema de gestión para restaurantes con varias sucursales. Permite administrar el menú, los pedidos, la cocina, las reservaciones, el inventario, los pagos, el programa de lealtad, las reseñas, las notificaciones y los reportes.

**Proyecto académico:** Ingeniería de Software — Universidad Centroamericana José Simeón Cañas (UCA), ciclo 02/2026.

## Tecnologías

El backend está desarrollado con Node.js, NestJS y Prisma. Utiliza PostgreSQL en Supabase y está desplegado en Railway.

## API

- **API:** https://practical-transformation-staging.up.railway.app/api
- **Estado del servicio:** https://practical-transformation-staging.up.railway.app/api/health
- **Documentación Swagger:** https://practical-transformation-staging.up.railway.app/api/docs

## Equipo de backend

El desarrollo se distribuyó entre dos integrantes, con un total de **10 módulos y 35 historias de usuario**.

| Integrante | GitHub | Módulos desarrollados | Total |
|---|---|---|---|
| **Marcelo Enrique Campos Reyes (00148023)** | [Marceloereyes](https://github.com/Marceloereyes) | Módulo 3 (H6–H9), cocina y entrega de pedidos; módulo 4 (H10–H12), reservaciones; módulo 5 (H13–H15), inventario; módulo 8 (H23–H25), reseñas y calificaciones; módulo 10 (H31–H35), reportes y estadísticas. | **18 historias** |
| **Christian Eduardo Melgar Canizalez (00110219)** | [ChrMlg](https://github.com/ChrMlg) | Módulo 1 (H1–H3), menú y catálogo; módulo 2 (H4–H5), registro de pedidos; módulo 6 (H16–H18), pagos y comprobantes; módulo 7 (H19–H22), programa de lealtad; módulo 9 (H26–H30), notificaciones centralizadas. | **17 historias** |

Las historias y sus enlaces de seguimiento están detallados en [Historias de usuario](docs/08-historias.md).

## Ejecución local

Se requiere Node.js 22 o superior y Docker con Compose.

Desde la raíz del repositorio:

```bash
npm ci
npm start
```

La API local estará disponible en `http://127.0.0.1:3000/api` y Swagger en `http://127.0.0.1:3000/api/docs`.

La configuración y los demás comandos se explican en la [guía de instalación local](docs/05-instalacion-local.md).

## Documentación

- [Guía de uso](docs/01-guia-de-uso.md)
- [Arquitectura](docs/02-arquitectura.md)
- [Modelo de datos](docs/03-modelo-de-datos.md)
- [API](docs/04-api.md)
- [Instalación local](docs/05-instalacion-local.md)
- [Despliegue](docs/06-despliegue.md)
- [Forma de trabajo](docs/07-forma-de-trabajo.md)
- [Historias de usuario](docs/08-historias.md)
- [Problemas conocidos](docs/09-problemas-conocidos.md)
