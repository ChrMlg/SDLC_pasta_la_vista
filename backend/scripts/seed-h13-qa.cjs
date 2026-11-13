const { PrismaClient } = require('@prisma/client');
const { randomBytes, randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('../dist/auth/credentials');
const { seedInventoryItems } = require('../prisma/seed-inventory.cjs');

const connection = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || !connection.pathname.endsWith('_test'))
  throw new Error('H13 QA requiere PostgreSQL local con nombre terminado en _test');
const db = new PrismaClient();
(async () => {
  const branches = [];
  for (const [code, name] of [['QA-H13-CEN', 'QA Inventario Centro'], ['QA-H13-BAM', 'QA Inventario Bambu'], ['QA-H13-EMPTY', 'QA Inventario vacio']])
    branches.push(await db.branch.upsert({ where: { code }, create: { code, name }, update: {} }));
  await seedInventoryItems(db, branches.slice(0, 2).map(branch => branch.id));
  const variables = { baseUrl: process.env.QA_BASE_URL || 'http://127.0.0.1:3310/api', branchId: branches[0].id,
    otherBranchId: branches[1].id, emptyBranchId: branches[2].id, missingBranchId: randomUUID() };
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(password);
  for (const [label, role, branchId] of [
    ['customer', 'CUSTOMER', null], ['waiter', 'WAITER', branches[0].id], ['kitchen', 'KITCHEN', branches[0].id],
    ['manager', 'MANAGER', branches[0].id], ['otherManager', 'MANAGER', branches[1].id], ['general', 'GENERAL_MANAGER', null],
  ]) {
    const email = `${label.toLowerCase()}.h13@sdlc-qa.invalid`;
    const data = { passwordHash, role, branchId, isActive: true };
    await db.user.upsert({ where: { email }, create: { email, ...data }, update: data });
    variables[label + 'Email'] = email; variables[label + 'Password'] = password;
  }
  writeFileSync(path.resolve(__dirname, '../../postman/.env.h13.local'), JSON.stringify({
    name: 'H13 QA local', values: Object.entries(variables).map(([key, value]) => ({ key, value, enabled: true, type: key.endsWith('Password') ? 'secret' : 'default' })),
    _postman_variable_scope: 'environment',
  }, null, 2), { mode: 0o600 });
  console.log('H13: datos locales preparados. Entorno privado en postman/.env.h13.local.');
})().catch(() => { console.error('No se pudo preparar H13 QA. Revise la base local y sus migraciones.'); process.exitCode = 1; }).finally(() => db.$disconnect());
