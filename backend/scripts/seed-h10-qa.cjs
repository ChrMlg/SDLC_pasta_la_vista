const { PrismaClient } = require('@prisma/client');
const { randomBytes, randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('../dist/auth/credentials');
const { localParts } = require('../dist/common/local-time');
const { seedReservationTables } = require('../prisma/seed.cjs');

const connection = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) || !connection.pathname.endsWith('_test'))
  throw new Error('H10 QA requiere una base PostgreSQL local con nombre terminado en _test');
const db = new PrismaClient();
(async () => {
  const branches = [];
  for (const [code, name] of [['QA-H10-CEN', 'QA Centro'], ['QA-H10-BAM', 'QA Bambu'], ['QA-H10-RAM', 'QA Ramblas']])
    branches.push(await db.branch.upsert({ where: { code }, create: { code, name }, update: {} }));
  await seedReservationTables(db, branches.map(branch => branch.id));
  const variables = {
    baseUrl: process.env.QA_BASE_URL || 'http://127.0.0.1:3310/api', branchId: branches[0].id,
    missingBranchId: randomUUID(), reservationDate: localParts(new Date(Date.now() + 7 * 86400000)).date,
  };
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(password);
  for (const [label, role] of [['customer', 'CUSTOMER'], ['manager', 'MANAGER'], ['waiter', 'WAITER'], ['kitchen', 'KITCHEN'], ['general', 'GENERAL_MANAGER']]) {
    const email = `${label}.h10@sdlc-qa.invalid`;
    const data = { passwordHash, role, branchId: ['CUSTOMER', 'GENERAL_MANAGER'].includes(role) ? null : branches[0].id, isActive: true };
    await db.user.upsert({ where: { email }, create: { email, ...data }, update: data });
    variables[label + 'Email'] = email; variables[label + 'Password'] = password;
  }
  writeFileSync(path.resolve(__dirname, '../../postman/.env.h10.local'), JSON.stringify({
    name: 'H10 QA local', values: Object.entries(variables).map(([key, value]) => ({ key, value, enabled: true, type: key.endsWith('Password') ? 'secret' : 'default' })),
    _postman_variable_scope: 'environment',
  }, null, 2), { mode: 0o600 });
  console.log('H10: datos locales preparados. Entorno privado en postman/.env.h10.local.');
})().catch(() => { console.error('No se pudo preparar H10 QA. Revise la base local y sus migraciones.'); process.exitCode = 1; }).finally(() => db.$disconnect());
