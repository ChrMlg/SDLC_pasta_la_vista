// Requires a dedicated migrated PostgreSQL database and a built backend.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const testUrl = process.env.CATALOG_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Set CATALOG_TEST_DATABASE_URL to a dedicated migrated PostgreSQL test database.');
const url = new URL(testUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) throw new Error('CATALOG_TEST_DATABASE_URL must point to a PostgreSQL database whose name ends in _test.');
const { PrismaClient } = require('@prisma/client');
const { PrismaMenuRepository } = require('../dist/menu/prisma-menu.repository');
const { MenuService } = require('../dist/menu/menu.service');
const db = new PrismaClient({ datasources: { db: { url: testUrl } } });

test('digital menu PostgreSQL search, isolation, ordering and read-only behavior', async () => {
  const branchId = randomUUID(), other = randomUUID(), userId = randomUUID();
  const service = new MenuService(new PrismaMenuRepository(db));
  const session = { userId, role: 'CUSTOMER', branchId: null };
  try {
    await db.branch.createMany({ data: [{ id: branchId, code: branchId, name: 'Menu test' }, { id: other, code: other, name: 'Other test' }] });
    await db.user.create({ data: { id: userId, role: 'MANAGER', branchId } });
    const names = ['Café', 'Cafe', 'PIZZA', '100% natural', 'A_b', ...Array.from({length: 11}, (_, i) => `Dish ${String(i).padStart(2, '0')}`)];
    await db.menuItem.createMany({ data: names.map((name, i) => ({ branchId, name, normalizedName: name.toLowerCase(), category: ['STARTER', 'MAIN_COURSE', 'DRINK', 'DESSERT'][i % 4], price: '12.50', description: 'Original', isAvailable: i !== 0, createdById: userId })) });
    await db.menuItem.create({ data: { branchId: other, name: 'Pizza ajena', normalizedName: 'pizza ajena', category: 'STARTER', price: '1.00', createdById: userId } });
    const before = await db.menuItem.findMany({ where: { branchId }, orderBy: { id: 'asc' } });
    for (const [search, expected] of [['CAFÉ', 'Café'], ['cafe', 'Cafe'], ['pizza', 'PIZZA'], ['%', '100% natural'], ['_', 'A_b']]) {
      const result = await service.list(branchId, session, { search }, false);
      assert.deepEqual(result.data.map(item => item.name), [expected]);
      assert.equal(result.total, 1);
    }
    const accented = await service.list(branchId, session, { search: 'afé' }, false);
    assert.equal(accented.data[0].isAvailable, false);
    assert.equal(accented.data[0].price, '12.50');
    assert.equal(accented.data[0].description, 'Original');
    assert.deepEqual(Object.keys(accented.data[0]).sort(), ['id', 'name', 'description', 'category', 'price', 'isAvailable'].sort());
    const first = await service.list(branchId, session, {}, false);
    const second = await service.list(branchId, session, { page: '2' }, false);
    const ordered = await db.menuItem.findMany({ where: { branchId }, orderBy: [{name:'asc'}, {id:'asc'}] });
    assert.equal(first.total, names.length);
    assert.deepEqual([...first.data, ...second.data].map(item => item.id), ordered.map(item => item.id));
    assert.deepEqual(await service.list(branchId, session, { page: '99' }, false), { data: [], total: names.length, page: 99, pageSize: 10 });
    assert.deepEqual(await db.menuItem.findMany({ where: { branchId }, orderBy: { id: 'asc' } }), before);
  } finally {
    try { await db.menuItem.deleteMany({ where: { branchId: { in: [branchId, other] } } }); await db.user.deleteMany({ where: { id: userId } }); await db.branch.deleteMany({ where: { id: { in: [branchId, other] } } }); } finally { await db.$disconnect(); }
  }
});
