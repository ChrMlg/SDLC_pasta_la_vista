// Requires a dedicated migrated PostgreSQL database and a built backend.
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
const { PrismaMenuRepository } = require('../dist/menu/prisma-menu.repository');
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

test('availability transitions, conflicts, concurrency and audit rollback in PostgreSQL', async () => {
  const branchId = randomUUID();
  const userId = randomUUID();
  const repo = new PrismaMenuRepository(db);
  try {
    await db.branch.create({ data: { id: branchId, code: branchId, name: 'Availability test' } });
    await db.user.create({ data: { id: userId, role: 'MANAGER', branchId } });
    const item = await db.menuItem.create({ data: { branchId, name: 'Test', normalizedName: 'test', category: 'STARTER', price: '1.00', createdById: userId } });
    assert.equal(await repo.changeAvailability(branchId, item.id, true, userId), 'conflict');
    assert.equal(await repo.changeAvailability(randomUUID(), item.id, false, userId), null);
    const race = await Promise.all([0, 1].map(() => repo.changeAvailability(branchId, item.id, false, userId)));
    assert.equal(race.filter(value => value === 'conflict').length, 1);
    const changed = race.find(value => value && value !== 'conflict');
    assert.equal(changed.isAvailable, false);
    assert.equal(changed.updatedById, userId);
    const beforeConflict = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(await repo.changeAvailability(branchId, item.id, false, userId), 'conflict');
    const afterConflict = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(afterConflict.updatedAt.getTime(), beforeConflict.updatedAt.getTime());
    let history = await db.menuAvailabilityChange.findMany({ where: { menuItemId: item.id } });
    assert.equal(history.length, 1);
    assert.deepEqual([history[0].oldValue, history[0].newValue, history[0].changedById], [true, false, userId]);
    assert.ok(history[0].createdAt instanceof Date);
    // Inject an audit write failure after the real update, inside the real DB transaction.
    const failingRepo = new PrismaMenuRepository({
      $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
        get(target, property) {
          if (property === 'menuAvailabilityChange') return { create: async () => { throw new Error('audit failure'); } };
          return Reflect.get(target, property);
        },
      }))),
    });
    await assert.rejects(failingRepo.changeAvailability(branchId, item.id, true, userId), /audit failure/);
    const afterFailure = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(afterFailure.isAvailable, false);
    assert.equal(afterFailure.updatedById, userId);
    assert.equal(afterFailure.updatedAt.getTime(), beforeConflict.updatedAt.getTime());
    assert.equal(await db.menuAvailabilityChange.count({ where: { menuItemId: item.id } }), 1);
    const restored = await repo.changeAvailability(branchId, item.id, true, userId);
    assert.equal(restored.isAvailable, true);
    history = await db.menuAvailabilityChange.findMany({ where: { menuItemId: item.id }, orderBy: { createdAt: 'asc' } });
    assert.equal(history.length, 2);
    assert.deepEqual([history[1].oldValue, history[1].newValue, history[1].changedById], [false, true, userId]);
  } finally {
    try {
      await db.menuAvailabilityChange.deleteMany({ where: { menuItem: { branchId } } });
      await db.menuItem.deleteMany({ where: { branchId } });
      await db.user.deleteMany({ where: { id: userId } });
      await db.branch.deleteMany({ where: { id: branchId } });
    } finally { await db.$disconnect(); }
  }
});
