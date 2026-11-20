const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { root, loadProjectConfig } = require('./project-db-config.cjs');

async function main() {
  const [target, action] = process.argv.slice(2), config = loadProjectConfig(target);
  const cliActions = { migrate: ['migrate', 'deploy'], status: ['migrate', 'status'], diff: ['migrate', 'diff', '--from-schema-datasource', 'backend/prisma/schema.prisma', '--to-schema-datamodel', 'backend/prisma/schema.prisma', '--exit-code'] };
  if (cliActions[action]) {
    const args = [require.resolve('prisma/build/index.js'), ...cliActions[action], ...(action === 'diff' ? [] : ['--schema', 'backend/prisma/schema.prisma'])];
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...config } });
    process.exitCode = result.status ?? 1; return;
  }
  if (action !== 'seed') throw new Error('Acción válida: migrate, status, diff o seed; use npm start para levantar Docker');
  const result = spawnSync(process.execPath, [path.join(root, 'backend/scripts/seed-evaluation.cjs')], { cwd: root, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
main().catch(error => { console.error(`Operación del proyecto falló (${error.code || error.name}); revise conexión, migraciones y archivos privados. No se restablecen datos.`); process.exitCode = 1; });
