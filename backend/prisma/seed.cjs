const { PrismaClient } = require('@prisma/client');

// Orden: Centro, Bambu, Ramblas. Conserva capacidades y estados ya configurados.
async function seedReservationTables(db, branchIds) {
  if (branchIds.length !== 3 || new Set(branchIds).size !== 3 || branchIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))
    throw new Error('Indique tres IDs de sucursal distintos: Centro, Bambu y Ramblas');
  const capacities = [
    [8, 8, 8, 8, 6, 6, 6, 6, 6, 4, 4, 4],
    [8, 8, 8, 6, 6, 6, 6, 4, 4, 4],
    [8, 8, 6, 6, 6, 4, 4, 4],
  ];
  await db.$transaction(async tx => {
    if (await tx.branch.count({ where: { id: { in: branchIds } } }) !== 3)
      throw new Error('Las tres sucursales deben existir antes de cargar mesas');
    for (const [index, branchId] of branchIds.entries()) {
      for (const [position, capacity] of capacities[index].entries()) {
        const number = position + 1;
        await tx.table.upsert({ where: { branchId_number: { branchId, number } }, create: { branchId, number, capacity }, update: {} });
        await tx.table.updateMany({ where: { branchId, number, capacity: null }, data: { capacity } });
      }
    }
  });
}

if (require.main === module) {
  const db = new PrismaClient();
  seedReservationTables(db, [process.env.RESERVATION_CENTRO_ID, process.env.RESERVATION_BAMBU_ID, process.env.RESERVATION_RAMBLAS_ID])
    .then(() => console.log('H10: mesas iniciales preparadas.'))
    .catch(() => { console.error('No se pudieron cargar las mesas. Revise los IDs de sucursal, la conexión y las migraciones.'); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}

module.exports = { seedReservationTables };
