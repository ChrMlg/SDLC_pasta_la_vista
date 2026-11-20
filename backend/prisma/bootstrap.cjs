const { PrismaClient } = require('@prisma/client');
const { seedReservationTables, seedLoyaltyRule } = require('./seed.cjs');
const { seedInventoryItems } = require('./seed-inventory.cjs');

// Identidades originales creadas por las migraciones del backend compartido.
const branchIds = [
  'a1111111-1111-4111-8111-111111111111',
  'a2222222-2222-4222-8222-222222222222',
  'a3333333-3333-4333-8333-333333333333',
];
const db = new PrismaClient();
(async () => {
  await seedReservationTables(db, branchIds);
  await seedInventoryItems(db, branchIds);
  await seedLoyaltyRule(db);
  if (process.env.LOCAL_ACCESS_KEY) await require('./initial-accounts.cjs').provisionInitialAccounts(db, process.env.LOCAL_ACCESS_KEY, process.env.LOCAL_ACCESS_VERSION);
  if (process.env.DISABLE_LEGACY_DEMO === 'true') {
    // Cuentas históricas de migraciones: las credenciales de evaluación son privadas.
    const ids = [1, 2, 3, 4, 5, 6, 7].map(n => `d${String(n).repeat(7)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`);
    await db.user.updateMany({ where: { id: { in: ids }, email: { endsWith: '@bistro.demo' } }, data: { isActive: false } });
    await db.authSession.deleteMany({ where: { userId: { in: ids }, user: { isActive: false } } });
  }
  console.log('Datos iniciales H10/H13/H22 preparados; existencias y configuraciones previas conservadas.');
})().catch(() => {
  console.error('No se pudo completar la inicialización local. Revise migraciones y conexión; no se restablecieron datos.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
