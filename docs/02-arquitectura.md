# Arquitectura

```mermaid
flowchart LR
  P[Navegador con Swagger o Postman] -->|HTTPS| C[Caddy en DigitalOcean]
  F[Frontend requerido: pendiente] -.->|HTTPS| C
  subgraph Droplet[DigitalOcean Droplet]
    C -->|HTTP interno 3000| B[Backend NestJS]
  end
  B -->|Prisma sobre TLS| D[(PostgreSQL en Supabase)]
```

Arquitectura de producción preparada; publicación aún pendiente. En desarrollo, Compose raíz mantiene PostgreSQL 16 en un volumen local y publica API/BD solo en loopback.

| Capa | Tecnología |
|---|---|
| Backend | Node.js 22, NestJS 10, TypeScript |
| Datos | Prisma 5, PostgreSQL (16 local; versión administrada por Supabase en producción) |
| API | REST JSON, Swagger |
| Pruebas | Jest, node:test, Newman |
| Ejecución | Docker Compose local: db y backend; producción: backend y Caddy |

## Estructura

- `backend/src`: módulos de dominio y servicios.
- `backend/prisma`: esquema, migraciones y semillas.
- `backend/scripts`: arranque, exportación de accesos y comprobaciones.
- `backend/test`: regresiones existentes.
- `postman`: una colección y un environment privado generado.
- `docs`: documentación y trazabilidad.

## Decisiones

| Decisión | Motivo |
|---|---|
| Sesión opaca en cookie HttpOnly y registro AuthSession | Identidad verificada en servidor, sin confiar en roles enviados por el cliente |
| Transacciones y bloqueos PostgreSQL | Evitar doble reserva, doble toma de comanda y stock inconsistente |
| Decimal para precios | Evitar errores de representación monetaria |
| Una base persistente por instalación | Conservar datos al reiniciar y no depender de una base temporal |
| Credenciales fuera de Git | Acceso reproducible sin publicar secretos |
| Supabase por conexión PostgreSQL TLS, Data API desactivada | Conservar las reglas y permisos de NestJS sin exponer tablas directamente |
| Session pooler 5432 para el Droplet | Conexión IPv4 compatible con Prisma y migraciones |
