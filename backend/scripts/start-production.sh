#!/bin/sh
set -eu

# Prisma 5 exige DIRECT_URL porque prisma/schema.prisma usa directUrl.
# Supabase Session pooler (5432) y conexiones directas sirven para el
# runtime y las migraciones. El Transaction pooler (6543) no sirve para migrar.
if [ -z "${DATABASE_URL:-}" ]; then
  echo 'Falta DATABASE_URL. Configura la conexión PostgreSQL en Railway > Variables.' >&2
  exit 1
fi

if [ -z "${DIRECT_URL:-}" ]; then
  case "$DATABASE_URL" in
    *:6543/*|*pgbouncer=true*)
      echo 'Falta DIRECT_URL: DATABASE_URL usa Transaction pooler. Configura DIRECT_URL con la conexión directa o Session pooler (puerto 5432) en Railway > Variables.' >&2
      exit 1
      ;;
    *)
      # Conexión directa/Session pooler: reutilizarla sin imprimir credenciales.
      DIRECT_URL="$DATABASE_URL"
      export DIRECT_URL
      ;;
  esac
fi

# Deshabilitar cuentas demo históricas cuando el backend se despliega.
export DISABLE_LEGACY_DEMO=true

node scripts/validate-production.cjs
../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
node prisma/bootstrap.cjs
exec node dist/main.js
