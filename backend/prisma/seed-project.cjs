const { hashPassword, verifyPassword } = require('../dist/auth/credentials');
const data = require('./project-data.cjs');

async function seedProjectData(db, credentials) {
  const users = [];
  for (const { label, ...user } of data.users) {
    const account = credentials[label];
    if (!account || typeof account.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) ||
      account.email !== account.email.trim().toLowerCase() || typeof account.password !== 'string' || account.password.length < 24)
      throw new Error('Configure correo y contraseña en el archivo privado del proyecto');
    users.push({ ...user, email: account.email, passwordHash: await hashPassword(account.password) });
  }
  if (new Set(users.map(user => user.email)).size !== users.length) throw new Error('Los correos deben ser distintos');
  return db.$transaction(async tx => {
    const branches = await tx.branch.findMany({ where: { id: { in: data.branches.map(row => row.id) } } });
    if (branches.length !== 3 || data.branches.some(row => !branches.some(saved => saved.id === row.id && saved.code === row.code)))
      throw new Error('Aplique las migraciones; se requieren las sucursales originales');
    await tx.table.createMany({ data: data.tables, skipDuplicates: true });
    // Solo completa capacidades todavía vacías; conserva las configuradas y los estados operativos.
    for (const row of data.tables) await tx.table.updateMany({ where: { branchId: row.branchId, number: row.number, capacity: null }, data: { capacity: row.capacity } });
    await tx.inventoryItem.createMany({ data: data.inventory, skipDuplicates: true });
    await tx.user.createMany({ data: users, skipDuplicates: true });
    for (const user of data.users) {
      const saved = await tx.user.findUnique({ where: { id: user.id } });
      const account = credentials[user.label];
      if (!saved || saved.email !== account.email || saved.role !== user.role || saved.branchId !== user.branchId || !saved.passwordHash || !await verifyPassword(account.password, saved.passwordHash))
        throw new Error('La cuenta existente no coincide con las credenciales conservadas; no se sobrescribe');
    }
    const tables = await tx.table.findMany({ where: { branchId: { in: data.branches.map(row => row.id) }, number: 1 } });
    await tx.reservation.createMany({ data: data.reservations.map(({ branchIndex, ...row }) => ({ ...row, tableId: tables.find(table => table.branchId === row.branchId).id })), skipDuplicates: true });
    return { branches: branches.length, tables: data.tables.length, inventory: data.inventory.length, users: users.length, reservations: data.reservations.length };
  }, { timeout: 60000 });
}
module.exports = { seedProjectData };
