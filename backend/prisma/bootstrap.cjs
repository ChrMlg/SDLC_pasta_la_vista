const { PrismaClient } = require('@prisma/client');
const { seedReservationTables } = require('./seed.cjs');
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
  console.log('Datos iniciales H10/H13 preparados; existencias y configuraciones previas conservadas.');
})().catch(() => {
  console.error('No se pudo completar la inicialización local. Revise migraciones y conexión; no se restablecieron datos.');
  process.exitCode = 1;
}).finally(() => db.$disconnect());
