# Arquitectura

```mermaid
flowchart LR
  P[Navegador con Swagger o Postman] -->|HTTPS| C[HTTPS de Railway]
  F[Interfaz web fuera de este repositorio] -.->|HTTPS| C
  subgraph Railway[Servicio Railway]
    C -->|HTTP interno PORT| B[Backend NestJS]
  end
  B -->|Prisma sobre TLS| D[(PostgreSQL en Supabase)]
```

Backend comunicado como desplegado por el equipo el 20/11/2026 en Railway con PostgreSQL administrado por Supabase. La vinculación al commit definitivo de `main`/`v1.0.0` debe comprobarse al publicar. En desarrollo, Compose raíz mantiene PostgreSQL 16 en un volumen local y publica API/BD solo en loopback.

| Capa | Tecnología |
|---|---|
| Backend | Node.js 22, NestJS 10, TypeScript |
| Datos | Prisma 5, PostgreSQL (16 local; versión administrada por Supabase en producción) |
| API | REST JSON, Swagger |
| Pruebas | Jest, node:test, Newman |
| Ejecución | Docker Compose local: db y backend; producción: imagen Docker en Railway |

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
| Session pooler 5432 para Railway | Conexión IPv4 compatible con Prisma y migraciones |
