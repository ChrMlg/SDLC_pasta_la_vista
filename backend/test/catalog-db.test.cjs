// Run only against a dedicated, migrated database whose name ends in _test.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');

const testUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Set CATALOG_TEST_DATABASE_URL to a dedicated migrated PostgreSQL test database.');
const url = new URL(testUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
  throw new Error('CATALOG_TEST_DATABASE_URL must point to a PostgreSQL database whose name ends in _test.');
}
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

test('catalog constraints, relations and concurrent inserts in PostgreSQL', async () => {
  const runId = randomUUID();
  const branchIds = [randomUUID(), randomUUID()];
  const users = [
    { id: randomUUID(), role: 'MANAGER', branchId: branchIds[0] },
    { id: randomUUID(), role: 'MANAGER', branchId: branchIds[1] },
    { id: randomUUID(), role: 'GENERAL_MANAGER', branchId: null },
    { id: randomUUID(), role: 'CUSTOMER', branchId: null },
    { id: randomUUID(), role: 'WAITER', branchId: branchIds[0] },
    { id: randomUUID(), role: 'KITCHEN', branchId: branchIds[0] },
  ];
  const item = (branchId, normalizedName) => ({
    branchId, name: normalizedName, normalizedName, category: 'STARTER',
    price: '12.50', createdById: users[0].id,
  });
  try {
    await db.branch.createMany({ data: branchIds.map((id, i) => ({ id, code: `${runId}-${i}`, name: `Test ${i}` })) });
    await db.user.createMany({ data: users });
    const first = await db.menuItem.create({ data: item(branchIds[0], 'sopa') });
    await db.menuItem.create({ data: item(branchIds[1], 'sopa') });
    assert.equal(first.isAvailable, true);
    assert.equal(first.description, null);
    assert.equal(first.updatedById, null);
    assert.equal(first.createdById, users[0].id);
    assert.ok(first.createdAt instanceof Date && first.updatedAt instanceof Date);
    await assert.rejects(db.menuItem.create({ data: item(branchIds[0], 'sopa') }), { code: 'P2002' });
    await assert.rejects(db.menuItem.create({ data: item(randomUUID(), 'missing branch') }), { code: 'P2003' });
    await assert.rejects(db.menuItem.create({ data: { ...item(branchIds[0], 'missing creator'), createdById: randomUUID() } }), { code: 'P2003' });
    await assert.rejects(db.menuItem.create({ data: { ...item(branchIds[0], 'bad price'), price: '0.00' } }));
    const edited = await db.menuItem.update({ where: { id: first.id }, data: { updatedById: users[1].id, description: 'Test' } });
    assert.equal(edited.updatedById, users[1].id);
    const audit = await db.menuAvailabilityChange.create({ data: { menuItemId: first.id, oldValue: true, newValue: false, changedById: users[0].id } });
    assert.equal(audit.menuItemId, first.id);
    assert.equal(audit.changedById, users[0].id);
    await assert.rejects(db.menuAvailabilityChange.create({ data: { menuItemId: randomUUID(), oldValue: true, newValue: false, changedById: users[0].id } }), { code: 'P2003' });
    await assert.rejects(db.menuAvailabilityChange.create({ data: { menuItemId: first.id, oldValue: true, newValue: false, changedById: randomUUID() } }), { code: 'P2003' });
    await assert.rejects(db.menuItem.delete({ where: { id: first.id } }), { code: 'P2003' });
    const race = await Promise.allSettled([0, 1].map(() => db.menuItem.create({ data: item(branchIds[0], 'concurrent') })));
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = race.find(result => result.status === 'rejected');
    assert.equal(rejected?.reason.code, 'P2002');
    assert.equal(await db.menuItem.count({ where: { branchId: branchIds[0], normalizedName: 'concurrent' } }), 1);
  } finally {
    try {
      await db.menuAvailabilityChange.deleteMany({ where: { menuItem: { branchId: { in: branchIds } } } });
      await db.menuItem.deleteMany({ where: { branchId: { in: branchIds } } });
      await db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
      await db.branch.deleteMany({ where: { id: { in: branchIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
