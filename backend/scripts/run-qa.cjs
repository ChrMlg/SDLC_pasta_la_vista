// Usa la misma conexión local de Compose, sin archivos de conexión por historia.
const { spawnSync } = require('node:child_process');
const { root, loadProjectConfig } = require('./project-db-config.cjs');
const values = loadProjectConfig('local');
const connection = new URL(values.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !['localhost', '127.0.0.1', '::1'].includes(connection.hostname))
  throw new Error('Las verificaciones deben usar la conexión local del proyecto');
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Indique el comando de pruebas');
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...values, DIRECT_URL: values.DATABASE_URL, CATALOG_TEST_DATABASE_URL: values.DATABASE_URL, NODE_ENV: 'test', ALLOW_LOCAL_FIXTURES: '1' } });
if (result.error) { console.error('No se pudo ejecutar el comando de pruebas'); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
