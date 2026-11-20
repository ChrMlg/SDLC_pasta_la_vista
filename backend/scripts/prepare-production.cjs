const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');
const { validateProduction, validDomain } = require('./validate-production.cjs');
const target = path.resolve(__dirname, '../../deploy/railway/.env.production');

try {
  if (process.argv[2] === '--check') {
    const config = parseEnv(fs.readFileSync(target, 'utf8'));
    validateProduction(config);
    console.log('Configuración válida; conexión, migraciones y HTTPS aún requieren comprobación en el servidor.');
  } else {
    const domain = process.argv[2];
    if (!validDomain(domain)) throw new Error('Indique el dominio real de la API, sin protocolo ni ruta.');
    fs.writeFileSync(target, `DATABASE_URL=\nDIRECT_URL=\nLOCAL_ACCESS_KEY=${randomBytes(32).toString('hex')}\nLOCAL_ACCESS_VERSION=2\nPUBLIC_API_URL=https://${domain.toLowerCase()}/api\nCOOKIE_SECURE=true\nDISABLE_LEGACY_DEMO=true\nCORS_ORIGINS=\nRAILWAY_DOCKERFILE_PATH=backend/Dockerfile\n`, { mode: 0o600, flag: 'wx' });
    console.log('Configuración privada creada. Complete DATABASE_URL y DIRECT_URL desde Supabase; ejecute este comando con --check. Conserve LOCAL_ACCESS_KEY para mantener los usuarios.');
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Ya existe configuración privada; se conserva sin cambiar las credenciales.' : error.code === 'ENOENT' ? 'Primero genere la configuración con el dominio de la API.' : error.message);
  process.exitCode = 1;
}
