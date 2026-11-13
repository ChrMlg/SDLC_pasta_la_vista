const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, chmodSync } = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { root, loadProjectConfig } = require('./project-db-config.cjs');
const data = require('../prisma/project-data.cjs');

async function main() {
  const [target, action] = process.argv.slice(2), config = loadProjectConfig(target);
  const cliActions = { migrate: ['migrate', 'deploy'], status: ['migrate', 'status'], diff: ['migrate', 'diff', '--from-schema-datasource', 'backend/prisma/schema.prisma', '--to-schema-datamodel', 'backend/prisma/schema.prisma', '--exit-code'] };
  if (cliActions[action]) {
    const args = [require.resolve('prisma/build/index.js'), ...cliActions[action], ...(action === 'diff' ? [] : ['--schema', 'backend/prisma/schema.prisma'])];
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...config } });
    process.exitCode = result.status ?? 1; return;
  }
  if (action !== 'seed') throw new Error('Acción válida: migrate, status, diff o seed; use npm start para levantar Docker');
  const file = path.join(root, '.env.project.credentials');
  chmodSync(file, 0o600);
  const credentials = JSON.parse(readFileSync(file, 'utf8'));
  const db = new PrismaClient({ datasources: { db: { url: config.DIRECT_URL } } });
  try {
    const { seedProjectData } = require('../prisma/seed-project.cjs');
    const prepared = await seedProjectData(db, credentials);
    const inventory = await db.inventoryItem.findMany({ where: { branchId: { in: data.branches.map(row => row.id) } } });
    const variables = { baseUrl: config.PROJECT_BASE_URL, branchId: data.branches[0].id, otherBranchId: data.branches[1].id,
      thirdBranchId: data.branches[2].id, missingBranchId: data.id('missing'), itemId: inventory.find(row => row.branchId === data.branches[0].id && row.name === 'Arroz').id,
      otherItemId: inventory.find(row => row.branchId === data.branches[1].id && row.name === 'Arroz').id, reservationDate: '2030-02-15' };
    for (const user of data.users) { variables[user.label + 'Email'] = credentials[user.label].email; variables[user.label + 'Password'] = credentials[user.label].password; }
    const output = path.join(root, `postman/.env.project.${target}`);
    writeFileSync(output, JSON.stringify({ name: `Proyecto persistente ${target}`, values: Object.entries(variables).map(([key, value]) => ({ key, value, enabled: true, type: key.endsWith('Password') ? 'secret' : 'default' })), _postman_variable_scope: 'environment' }, null, 2), { mode: 0o600 });
    chmodSync(output, 0o600);
    console.log(JSON.stringify({ target, prepared, credentials: 'archivo privado conservado', environment: `postman/.env.project.${target}` }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(`Operación del proyecto falló (${error.code || error.name}); revise conexión, migraciones y archivos privados. No se restablecen datos.`); process.exitCode = 1; });
