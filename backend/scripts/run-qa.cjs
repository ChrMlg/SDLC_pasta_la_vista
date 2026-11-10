// Carga únicamente el entorno privado de pruebas; nunca utiliza backend/.env.
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const values = parseEnv(readFileSync(path.resolve(root, process.env.QA_ENV_FILE || '.env.h10.qa.local'), 'utf8'));
const connection = new URL(values.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !['localhost', '127.0.0.1', '::1'].includes(connection.hostname) || !connection.pathname.endsWith('_test'))
  throw new Error('La base QA debe ser local y su nombre debe terminar en _test');
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Indique el comando de pruebas');
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...values, DIRECT_URL: values.DATABASE_URL, CATALOG_TEST_DATABASE_URL: values.DATABASE_URL, NODE_ENV: 'test' } });
if (result.error) { console.error('No se pudo ejecutar el comando de pruebas'); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
