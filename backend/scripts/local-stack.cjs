const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const configFile = path.join(root, '.env.compose.local');
const project = 'sdlc-h10'; // Conserva la identidad del volumen ya utilizado por el equipo.

function loadLocalConfig() {
  const config = parseEnv(fs.readFileSync(configFile, 'utf8'));
  for (const key of ['POSTGRES_DB', 'POSTGRES_USER'])
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(config[key] || '')) throw new Error(`Revise ${key} en .env.compose.local`);
  if (!/^[a-zA-Z0-9_-]{8,}$/.test(config.POSTGRES_PASSWORD || ''))
    throw new Error('POSTGRES_PASSWORD requiere al menos 8 caracteres seguros para una URL');
  for (const [key, fallback] of [['API_PORT', '3000'], ['DB_PORT', '55440']]) {
    config[key] ||= fallback;
    if (!/^\d+$/.test(config[key]) || Number(config[key]) < 1 || Number(config[key]) > 65535) throw new Error(`Puerto inválido: ${key}`);
  }
  return config;
}

function saveLocalConfig(config) {
  fs.writeFileSync(configFile, Object.entries(config).map(([key,value]) => `${key}=${value}`).join('\n')+'\n', {mode:0o600});
  fs.chmodSync(configFile,0o600);
}
function migrateLegacyDatabase(config) {
  if (config.POSTGRES_DB !== 'sdlc_h10_test') return;
  const args=['compose','-p',project,'--env-file',configFile,'-f',path.join(root,'compose.yaml')];
  function docker(extra, input) {
    const result=spawnSync('docker',[...args,...extra],{cwd:root,input,encoding:'utf8'});
    if(result.status!==0) throw new Error('No se pudo actualizar la configuración de la base existente; no se borraron datos');
    return result.stdout;
  }
  docker(['up','-d','--wait','db']);
  const psql=['exec','-T','db','psql','-U',config.POSTGRES_USER,'-d','postgres','-v','ON_ERROR_STOP=1','-At'];
  const names=docker(psql, "SELECT datname FROM pg_database WHERE datname IN ('sdlc_h10_test','bistro');").trim().split('\n');
  if(names.includes('sdlc_h10_test') && names.includes('bistro')) throw new Error('Existen ambas bases; no se reemplaza ninguna. Revise cuál contiene los datos del proyecto');
  if(names.includes('sdlc_h10_test')) {
    docker(['stop','backend']);
    docker(psql, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='sdlc_h10_test' AND pid<>pg_backend_pid(); ALTER DATABASE "sdlc_h10_test" RENAME TO "bistro";`);
  } else if(!names.includes('bistro')) throw new Error('No se encontró la base persistente; no se crea otra automáticamente');
  config.POSTGRES_DB='bistro';saveLocalConfig(config);
  console.log('Base persistente actualizada a bistro; mismo volumen y mismos datos.');
}

function prepare() {
  if (!fs.existsSync(configFile)) {
    const existing = spawnSync('docker', ['volume', 'ls', '--filter', `name=^${project}_postgres_data$`, '--format', '{{.Name}}'], { encoding: 'utf8' });
    if (existing.error || existing.status !== 0) throw new Error('Inicie Docker antes de preparar el proyecto');
    if (existing.stdout.trim()) throw new Error('Existe un volumen: restaure su .env.compose.local privado; no se reemplazarán sus credenciales');
    fs.writeFileSync(configFile, `POSTGRES_DB=bistro\nPOSTGRES_USER=bistro\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nAPI_PORT=3000\nDB_PORT=55440\nCOOKIE_SECURE=false\n`, { mode: 0o600, flag: 'wx' });
  }
  fs.chmodSync(configFile, 0o600);
  const config = loadLocalConfig();
  if (!config.LOCAL_ACCESS_KEY) {
    config.LOCAL_ACCESS_KEY = config.LOCAL_DEMO_SEED || randomBytes(32).toString('hex');
    config.LOCAL_ACCESS_VERSION = config.LOCAL_DEMO_SEED ? '1' : '2';
    delete config.LOCAL_DEMO_SEED;
    saveLocalConfig(config);
  }
  if (!/^[a-f0-9]{64}$/.test(config.LOCAL_ACCESS_KEY)) throw new Error('LOCAL_ACCESS_KEY inválido; conserve el valor generado');
  migrateLegacyDatabase(config);
  const url = `postgresql://${config.POSTGRES_USER}:${config.POSTGRES_PASSWORD}@127.0.0.1:${config.DB_PORT}/${config.POSTGRES_DB}?schema=public`;
  const backendFile = path.join(root, 'backend/.env');
  const original = fs.existsSync(backendFile) ? fs.readFileSync(backendFile, 'utf8') : '';
  const values = parseEnv(original);
  if (values.DATABASE_URL !== url || values.DIRECT_URL !== url || values.PORT !== config.API_PORT) {
    // Archivo derivado de Compose: no genera copias de configuraciones anteriores.
    Object.assign(values, { DATABASE_URL: url, DIRECT_URL: url, PORT: config.API_PORT, COOKIE_SECURE: config.COOKIE_SECURE || 'false' });
    fs.writeFileSync(backendFile, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
    fs.chmodSync(backendFile, 0o600);
  }
}

function main() {
  const action = process.argv[2];
  if (!['start', 'stop', 'logs'].includes(action)) throw new Error('Use start, stop o logs');
  if (action === 'start') prepare();
  else loadLocalConfig();
  const args = ['compose', '-p', project, '--env-file', configFile, '-f', path.join(root, 'compose.yaml')];
  args.push(...(action === 'start' ? ['up', '-d', '--build', '--wait', 'db', 'backend'] : action === 'stop' ? ['stop', 'backend', 'db'] : ['logs', '--tail', '100', '-f', 'backend']));
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
  if (action === 'start' && result.status === 0) {
    const exported = spawnSync(process.execPath, [path.join(root, 'backend/scripts/export-team-access.cjs')], { cwd: root, stdio: 'inherit' });
    if (exported.status !== 0) process.exitCode = exported.status ?? 1;
    else console.log('Backend listo. Postman: importar SDLC-Backend.postman_collection.json y SDLC.postman_environment.json desde postman. Pasos y accesos: ACCESOS_LOCALES.md.');
  }
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { loadLocalConfig, root };
