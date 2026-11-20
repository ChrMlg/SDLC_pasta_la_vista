const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { parseEnv } = require('node:util');
const { validateProduction, validDomain } = require('./validate-production.cjs');
const target = path.resolve(__dirname, '../../deploy/digitalocean/.env.production');

try {
  if (process.argv[2] === '--check') {
    const config = parseEnv(fs.readFileSync(target, 'utf8'));
    validateProduction({ ...config, COOKIE_SECURE: 'true', PUBLIC_API_URL: `https://${config.API_DOMAIN}/api` });
    console.log('Configuración válida; conexión, migraciones y HTTPS aún requieren comprobación en el servidor.');
  } else {
    const domain = process.argv[2];
    if (!validDomain(domain)) throw new Error('Indique el dominio real de la API, sin protocolo ni ruta.');
    fs.writeFileSync(target, `API_DOMAIN=${domain.toLowerCase()}\nDATABASE_URL=\nDIRECT_URL=\nLOCAL_ACCESS_KEY=${randomBytes(32).toString('hex')}\nCORS_ORIGINS=\n`, { mode: 0o600, flag: 'wx' });
    console.log('Configuración privada creada. Complete DATABASE_URL y DIRECT_URL desde Supabase; ejecute este comando con --check. Conserve LOCAL_ACCESS_KEY para mantener los usuarios.');
  }
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Ya existe configuración privada; se conserva sin cambiar las credenciales.' : error.code === 'ENOENT' ? 'Primero genere la configuración con el dominio de la API.' : error.message);
  process.exitCode = 1;
}
