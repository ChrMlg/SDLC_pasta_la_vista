const data = require('../prisma/project-data.cjs');

async function projectSnapshot(db) {
  const branchIds = data.branches.map(row => row.id);
  const [branches, tables, menu, inventory, users, reservations] = await Promise.all([
    db.branch.findMany({ where: { id: { in: branchIds } }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, openingTime: true, closingTime: true } }),
    db.table.findMany({ where: { branchId: { in: branchIds } }, orderBy: [{ branchId: 'asc' }, { number: 'asc' }], select: { branchId: true, number: true, capacity: true, status: true } }),
    db.menuItem.findMany({ where: { branchId: { in: branchIds } }, orderBy: [{ branchId: 'asc' }, { normalizedName: 'asc' }], select: { branchId: true, name: true, normalizedName: true, description: true, category: true, price: true, isAvailable: true } }),
    db.inventoryItem.findMany({ where: { branchId: { in: branchIds } }, orderBy: [{ branchId: 'asc' }, { name: 'asc' }], select: { id: true, branchId: true, name: true, unit: true, minStock: true, currentStock: true } }),
    db.user.findMany({ where: { id: { in: data.users.map(row => row.id) } }, orderBy: { id: 'asc' }, select: { id: true, email: true, role: true, branchId: true, isActive: true, firstName: true, lastName: true } }),
    db.reservation.findMany({ where: { id: { in: data.reservations.map(row => row.id) } }, orderBy: { id: 'asc' }, select: { id: true, branchId: true, table: { select: { number: true } }, customerId: true, date: true, startTime: true, endTime: true, partySize: true, status: true } }),
  ]);
  // Las migraciones históricas generaron IDs aleatorios de mesas y menú en cada instalación.
  return JSON.parse(JSON.stringify({ branches, tables, menu, inventory, users, reservations }));
}
module.exports = { projectSnapshot };
