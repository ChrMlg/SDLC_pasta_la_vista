#!/bin/sh
set -eu
# Railway ejecuta este comando desde /app/backend; no usar npm start de la raíz.
export DISABLE_LEGACY_DEMO=true
node scripts/validate-production.cjs
../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
node prisma/bootstrap.cjs
exec node dist/main.js
