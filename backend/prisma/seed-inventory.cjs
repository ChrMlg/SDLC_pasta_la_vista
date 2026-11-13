// Catálogo inicial de ejemplo. Los mínimos se ajustan al inventario real antes del despliegue.
const initialInventoryItems = [
  { name: 'Arroz', unit: 'g', minStock: 5000, currentStock: 0 },
  { name: 'Harina', unit: 'g', minStock: 5000, currentStock: 0 },
  { name: 'Aceite', unit: 'ml', minStock: 2000, currentStock: 0 },
  { name: 'Sal', unit: 'g', minStock: 500, currentStock: 0 },
  { name: 'Tomate', unit: 'unidad', minStock: 20, currentStock: 0 },
];

async function seedInventoryItems(db, branchIds) {
  if (!Array.isArray(branchIds) || branchIds.length === 0 || new Set(branchIds).size !== branchIds.length ||
    branchIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)))
    throw new Error('Indique IDs de sucursal válidos y distintos en INVENTORY_BRANCH_IDS');
  await db.$transaction(async tx => {
    if (await tx.branch.count({ where: { id: { in: branchIds } } }) !== branchIds.length)
      throw new Error('Todas las sucursales deben existir antes de cargar insumos');
    // La clave única permite repetir el seed, incluso concurrentemente, sin restablecer existencias.
    await tx.inventoryItem.createMany({
      data: branchIds.flatMap(branchId => initialInventoryItems.map(item => ({ branchId, ...item }))),
      skipDuplicates: true,
    });
  });
}

module.exports = { seedInventoryItems, initialInventoryItems };
