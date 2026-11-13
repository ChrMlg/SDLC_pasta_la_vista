const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { seedInventoryItems, initialInventoryItems } = require('../prisma/seed-inventory.cjs');

test('H13 #44: branch inventory with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use local PostgreSQL ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H13_TEST_PORT || 3326);
  const base = `http://127.0.0.1:${port}/api`;
  const branches = Array.from({ length: 5 }, () => randomUUID());
  const [branch, otherBranch, emptyBranch, seedBranch, cliBranch] = branches;
  const userIds = [], users = {}, cookies = {};
  const run = randomUUID();
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      await db.inventoryItem.deleteMany({ where: { branchId: { in: branches } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: branches } } });
    } finally { await db.$disconnect(); }
  });
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'ignore'],
  });
  let startupError, ready = false;
  server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || server.exitCode !== null) throw new Error('H13 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'H13 API starts within 10 seconds');
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H13-${run}-${i}`, name: `Sucursal H13 ${i}` })) });
  await seedInventoryItems(db, [branch, otherBranch]);
  await db.inventoryItem.update({ where: { branchId_name: { branchId: otherBranch, name: 'Arroz' } }, data: { currentStock: 99 } });
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(password);
  async function request(role, route, expected = 200, headers = {}) {
    const response = await fetch(base + route, { headers: { ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers } });
    const value = await response.json();
    assert.equal(response.status, expected, `${route}: ${response.status}, ${value.code || ''}`);
    if (expected >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return value;
  }
  for (const [label, role, branchId] of [
    ['customer', 'CUSTOMER', null], ['waiter', 'WAITER', branch], ['kitchen', 'KITCHEN', branch],
    ['manager', 'MANAGER', branch], ['otherManager', 'MANAGER', otherBranch], ['emptyManager', 'MANAGER', emptyBranch],
    ['unassigned', 'MANAGER', null], ['general', 'GENERAL_MANAGER', null],
  ]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h13.invalid`, passwordHash, role, branchId } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  const inventory = (id = branch) => `/management/branches/${id}/inventory`;

  await t.test('requires a verified session and rejects forged identity headers', async () => {
    await request(null, inventory(), 401);
    await request(null, inventory(), 401, { 'x-role': 'GENERAL_MANAGER', 'x-user-id': users.general.id, 'x-branch-id': branch });
  });
  for (const role of ['customer', 'waiter', 'kitchen']) await t.test(`${role} cannot read inventory`, async () => {
    await request(role, inventory(), 403);
  });
  await t.test('manager sees exactly the items of their branch with the six contract fields', async () => {
    const value = await request('manager', inventory());
    assert.equal(value.length, initialInventoryItems.length);
    assert.ok(value.every(item => item.branchId === branch && Number.isInteger(item.minStock) && Number.isInteger(item.currentStock)));
    assert.ok(value.every(item => Object.keys(item).sort().join() === 'branchId,currentStock,id,minStock,name,unit'));
    assert.deepEqual(value.map(item => item.name), ['Aceite', 'Arroz', 'Harina', 'Sal', 'Tomate']);
    assert.equal(value.find(item => item.name === 'Arroz').currentStock, 0);
    const other = await request('otherManager', inventory(otherBranch));
    assert.equal(other.find(item => item.name === 'Arroz').currentStock, 99);
    assert.ok(other.every(item => !value.some(own => own.id === item.id)));
  });
  await t.test('manager outside branch and unassigned manager receive 404', async () => {
    await request('manager', inventory(otherBranch), 404);
    await request('otherManager', inventory(), 404);
    await request('unassigned', inventory(), 404);
    await request('manager', inventory(otherBranch), 404, { 'x-branch-id': otherBranch, 'x-role': 'GENERAL_MANAGER' });
  });
  await t.test('general manager can explicitly select any existing branch', async () => {
    for (const branchId of [branch, otherBranch]) {
      const value = await request('general', inventory(branchId));
      assert.ok(value.length > 0 && value.every(item => item.branchId === branchId));
    }
  });
  await t.test('existing branch without items is 200 with an empty list; missing branch is 404', async () => {
    assert.deepEqual(await request('emptyManager', inventory(emptyBranch)), []);
    assert.deepEqual(await request('general', inventory(emptyBranch)), []);
    await request('general', inventory(randomUUID()), 404);
  });
  await t.test('invalid IDs and unsupported filters cannot override the route or session', async () => {
    await request('general', inventory('invalid'), 400);
    for (const query of [`branchId=${otherBranch}`, 'name=Arroz', 'currentStock=999', 'page=1', `userId=${users.general.id}`])
      await request('manager', inventory() + '?' + query, 400);
  });
  await t.test('reload reflects persisted stock without modifying items or creating anything', async () => {
    const item = await db.inventoryItem.findUniqueOrThrow({ where: { branchId_name: { branchId: branch, name: 'Sal' } } });
    await db.inventoryItem.update({ where: { id: item.id }, data: { currentStock: 27, minStock: 0 } });
    const before = await db.inventoryItem.findMany({ where: { branchId: branch }, orderBy: { id: 'asc' } });
    for (let repeat = 0; repeat < 2; repeat++) {
      const value = await request('manager', inventory());
      assert.equal(value.find(row => row.id === item.id).currentStock, 27);
      assert.equal(value.find(row => row.id === item.id).minStock, 0);
    }
    assert.deepEqual(await db.inventoryItem.findMany({ where: { branchId: branch }, orderBy: { id: 'asc' } }), before);
  });
  await t.test('database enforces nonnegative stock, nonblank labels and valid branch', async () => {
    const data = { branchId: branch, name: `Prueba ${run}`, unit: 'unidad', minStock: 1, currentStock: 0 };
    for (const changes of [{ minStock: -1 }, { currentStock: -1 }, { name: '   ' }, { unit: '' }, { branchId: randomUUID() }])
      await assert.rejects(db.inventoryItem.create({ data: { ...data, ...changes } }), `Invalid data: ${JSON.stringify(changes)}`);
    await assert.rejects(db.inventoryItem.create({ data: { ...data, name: 'Arroz' } }));
    assert.equal(await db.inventoryItem.count({ where: { name: data.name } }), 0);
  });
  await t.test('initial seed is repeatable and preserves existing units, thresholds and quantities', async () => {
    const existing = await db.inventoryItem.create({ data: { branchId: seedBranch, name: 'Arroz', unit: 'kg', minStock: 8, currentStock: 3 } });
    await seedInventoryItems(db, [seedBranch]);
    await seedInventoryItems(db, [seedBranch]);
    assert.equal(await db.inventoryItem.count({ where: { branchId: seedBranch } }), initialInventoryItems.length);
    assert.deepEqual(await db.inventoryItem.findUniqueOrThrow({ where: { id: existing.id } }), existing);
    assert.equal(await db.inventoryItem.count({ where: { branchId: emptyBranch } }), 0);
  });
  await t.test('concurrent seeds do not duplicate items or reset stock', async () => {
    await Promise.all([seedInventoryItems(db, [seedBranch]), seedInventoryItems(db, [seedBranch])]);
    assert.equal(await db.inventoryItem.count({ where: { branchId: seedBranch } }), initialInventoryItems.length);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { branchId_name: { branchId: seedBranch, name: 'Arroz' } } })).currentStock, 3);
  });
  await t.test('invalid seed selection is rejected without partially populating valid branches', async () => {
    for (const ids of [[], [emptyBranch, emptyBranch], ['invalid'], [emptyBranch, randomUUID()]])
      await assert.rejects(seedInventoryItems(db, ids));
    assert.equal(await db.inventoryItem.count({ where: { branchId: emptyBranch } }), 0);
  });
  await t.test('Prisma db seed entry point supports inventory scope without reservation IDs', async () => {
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'seed', '--schema', 'prisma/schema.prisma'], {
      cwd: path.resolve(__dirname, '..'), env: { ...process.env, SEED_SCOPE: 'inventory', INVENTORY_BRANCH_IDS: cliBranch,
        RESERVATION_CENTRO_ID: '', RESERVATION_BAMBU_ID: '', RESERVATION_RAMBLAS_ID: '' }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, 'Prisma seed inventory scope must finish successfully');
    assert.match(result.stdout, /H13: insumos iniciales preparados/);
    assert.equal(await db.inventoryItem.count({ where: { branchId: cliBranch } }), initialInventoryItems.length);
    assert.equal(await db.table.count({ where: { branchId: cliBranch } }), 0);
  });
  await t.test('revoked session loses access to inventory', async () => {
    const response = await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.manager } });
    assert.equal(response.status, 204);
    await request('manager', inventory(), 401);
  });
});
