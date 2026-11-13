# Corrección posterior a la integración de H10–H13

Fecha: 2026-11-13. Base revisada: `develop` en `fc1088f`, después de los merges de H10, H11 y H13; H12 estaba incluida en la cadena de commits integrada. El árbol resultante contiene el código de las cuatro historias. H14 se mantiene en una entrega aparte.

La sección 2.1.2 de la especificación de cátedra exige usar Docker Compose para ejecutar PostgreSQL y el backend localmente. Tras los merges faltaba completar y comprobar ese flujo: el arranque habitual se había orientado a una conexión remota, el backend no tenía publicado su puerto en Compose y el frontend se iniciaba por defecto. Conservar solamente el Dockerfile no completaba la entrega.

## Arreglos realizados

- `npm start` prepara la configuración privada y ejecuta Compose para construir/iniciar solamente PostgreSQL 16 y el backend NestJS.
- `npm stop` conserva el volumen; `npm run logs` muestra el backend. El nombre Compose queda fijo para reutilizar el volumen existente, sin crear una base por historia.
- Los puertos de PostgreSQL y de la API se publican únicamente en 127.0.0.1. Frontend queda en un perfil opcional.
- El Dockerfile aplica migraciones pendientes y ejecuta una inicialización idempotente: completa las mesas de H10 y los insumos de H13, conservando capacidades, estados y existencias configurados. Después ejecuta Node con manejo directo de señales.
- La conexión activa del host cambia a PostgreSQL local. La configuración anterior queda respaldada en un archivo privado ignorado; no se borraron ni modificaron datos remotos.
- Se exige contraseña privada para Compose; una instalación nueva recibe un valor aleatorio. Si el volumen ya existe y falta su configuración, el arranque pide recuperar ese archivo en vez de inventar otras credenciales.
- El texto de accesos y archivos de configuración privada se excluyen tanto de Git como del contexto Docker.

Los cambios locales previos de Docker de las ramas ya fusionadas se consolidan aquí. No se reescribe su historial ni se vuelven a fusionar esas historias. La corrección se sube directamente a develop por instrucción expresa del responsable.

## Validación ejecutada

- `npm start`: imagen construida; servicios db/backend saludables.
- `GET http://127.0.0.1:3000/api/health`: HTTP 200, `{"status":"ok"}`.
- Conexión observada dentro del contenedor: host `db`, base local existente `sdlc_h10_test`. Ese nombre técnico y volumen se conservan para no perder datos.
- `npm stop` seguido de `npm start`: las 30 mesas y 15 insumos de las sucursales originales conservaron exactamente sus valores.
- `docker compose --env-file .env.compose.local config --quiet`: aprobado.
- Generación Prisma y build TypeScript: aprobados.
- Pruebas unitarias: 25 aprobadas.
- H10: 28; H11: 23; H12: 18; H13: 17 aprobadas.
- Integración existente: 108 comprobaciones HTTP/concurrencia aprobadas.

El primer intento H10 coincidió con la construcción inicial, antes de estar disponible PostgreSQL; se repitió al quedar saludable y pasó. No se ejecutaron pruebas contra Supabase. El volumen conserva tablas de verificaciones previas de H14; no se eliminan al ejecutar una revisión anterior del código.

## Uso por el equipo

Con Docker iniciado y Node 22 o superior:

```bash
npm start
npm run logs
npm stop
```

El archivo `.env.compose.local` y las credenciales son privados. No usar `docker compose down -v`: eliminaría el volumen. Para el entorno ya existente, conservar el archivo de configuración que corresponde a ese volumen. Los clientes usan el login normal del backend; no se introducen contraseñas fijas en este arreglo.

Commit: `fix(H10-H13): completar arranque local con Docker Compose`.
Motivo: completar el requisito de infraestructura que faltaba verificar antes de los merges, conservando datos y evitando que el arranque dependa de Supabase.
