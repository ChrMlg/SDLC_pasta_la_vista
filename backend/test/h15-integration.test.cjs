const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { InventoryMovementsService } = require('../dist/inventory/inventory-movements.service');

test('H15 #46: inventory replenishment alerts with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use local PostgreSQL ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H15_TEST_PORT || 3328);
  const base = process.env.H15_API_URL || `http://127.0.0.1:${port}/api`;
  const api = new URL(base);
  assert.ok(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname), 'Use only the local API');
  const branch = randomUUID(), otherBranch = randomUUID(), run = randomUUID();
  const users = {}, cookies = {}, userIds = [], itemIds = [];
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      await db.inventoryAlert.deleteMany({ where: { itemId: { in: itemIds } } });
      await db.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await db.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: [branch, otherBranch] } } });
    } finally { await db.$disconnect(); }
  });
  if (!process.env.H15_API_URL) {
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H15 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: [branch, otherBranch].map((id, i) => ({ id, code: `H15-${run}-${i}`, name: `Sucursal H15 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role, branchId] of [
    ['customer', 'CUSTOMER', null], ['waiter', 'WAITER', branch], ['kitchen', 'KITCHEN', branch],
    ['manager', 'MANAGER', branch], ['otherManager', 'MANAGER', otherBranch], ['unassigned', 'MANAGER', null], ['general', 'GENERAL_MANAGER', null],
  ]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h15.invalid`, passwordHash, role, branchId } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  async function item(currentStock = 10, minStock = 5, branchId = branch) {
    const id = randomUUID(); itemIds.push(id);
    return db.inventoryItem.create({ data: { id, branchId, name: `Insumo ${id}`, unit: 'unidad', minStock, currentStock } });
  }
  const stock = id => db.inventoryItem.findUniqueOrThrow({ where: { id } });
  const movements = id => db.inventoryMovement.findMany({ where: { itemId: id } });
  const body = (row, changes = {}) => ({ branchId: row.branchId, itemId: row.id, quantity: 1, type: 'IN', reason: 'Recepción de mercadería', ...changes });
  async function request(role, input, expected, headers = {}) {
    const response = await fetch(base + '/management/inventory/movements', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers }, body: JSON.stringify(input) });
    const value = await response.json();
    if (expected !== undefined) assert.equal(response.status, expected, `${response.status}: ${value.code || ''}`);
    if (response.status >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return { status: response.status, value };
  }
  const alerts = id => db.inventoryAlert.findMany({ where: { itemId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  async function list(role, branchId = branch, expected = 200, query = '', headers = {}) {
    const response = await fetch(base + `/management/branches/${branchId}/inventory/alerts${query}`, {
      headers: { ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers }, signal: AbortSignal.timeout(10000),
    });
    const value = await response.json();
    assert.equal(response.status, expected, `GET alerts: ${response.status} ${value.code || ''}`);
    if (expected >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return value;
  }
  await t.test('requires a verified session and rejects forged headers', async () => {
    await list(null, branch, 401);
    await list(null, branch, 401, '', { 'x-role': 'GENERAL_MANAGER', 'x-user-id': users.general.id });
  });
  for (const role of ['customer', 'waiter', 'kitchen']) await t.test(`${role} cannot read alerts`, async () => { await list(role, branch, 403); });
  await t.test('manager scope and unassigned manager return 404', async () => {
    await list('manager', otherBranch, 404);
    await list('otherManager', branch, 404);
    await list('unassigned', branch, 404);
    await list('manager', otherBranch, 404, '', { 'x-role': 'GENERAL_MANAGER', 'x-branch-id': otherBranch });
  });
  await t.test('missing branch, invalid UUID and unsupported filters follow the error contract', async () => {
    await list('general', randomUUID(), 404);
    await list('general', 'invalid', 400);
    for (const query of ['?branchId=' + otherBranch, '?status=ACTIVE', '?createdById=' + users.general.id])
      await list('manager', branch, 400, query);
  });
  await t.test('empty branches return 200 arrays; listing never generates alerts', async () => {
    const row = await item(0, 5);
    assert.deepEqual(await list('manager'), []);
    assert.deepEqual(await list('general', otherBranch), []);
    assert.deepEqual(await alerts(row.id), []);
  });
  await t.test('OUT above minimum creates no alert, exact minimum creates one ACTIVE', async () => {
    const row = await item(7, 5);
    await request('manager', body(row, { type: 'OUT' }), 201);
    assert.deepEqual(await alerts(row.id), []);
    const since = Date.now();
    await request('manager', body(row, { type: 'OUT' }), 201);
    const [alert] = await alerts(row.id);
    assert.equal(alert.currentStock, 5); assert.equal(alert.minStock, 5); assert.equal(alert.status, 'ACTIVE');
    assert.equal(alert.branchId, branch); assert.equal(alert.itemId, row.id);
    assert.equal(alert.resolvedAt, null); assert.equal(alert.resolvedByUserId, null);
    assert.ok(alert.createdAt.getTime() >= since);
    const displayed = (await list('manager', branch.toUpperCase())).find(value => value.id === alert.id);
    assert.equal(displayed.item.name, row.name); assert.equal(displayed.item.unit, row.unit);
    assert.equal(displayed.branch.name, 'Sucursal H15 0'); assert.equal(displayed.item.currentStock, 5);
    assert.deepEqual(Object.keys(displayed).sort(), ['branch','branchId','createdAt','currentStock','id','item','itemId','minStock','resolvedAt','resolvedByUserId','status']);
    await request('manager', body(row, { type: 'OUT', quantity: 2 }), 201);
    assert.deepEqual(await alerts(row.id), [alert]);
    const refreshed = (await list('manager')).find(value => value.id === alert.id);
    assert.equal(refreshed.currentStock, 5); assert.equal(refreshed.item.currentStock, 3);
  });
  await t.test('IN below or at minimum generates an alert even when none existed', async () => {
    for (const quantity of [2, 5]) {
      const row = await item(0, 5);
      await request('manager', body(row, { quantity }), 201);
      const saved = await alerts(row.id);
      assert.equal(saved.length, 1); assert.equal(saved[0].currentStock, quantity); assert.equal(saved[0].status, 'ACTIVE');
    }
  });
  await t.test('IN above minimum generates no alert; zero threshold alerts only at zero', async () => {
    const sufficient = await item(0, 5);
    await request('manager', body(sufficient, { quantity: 6 }), 201);
    assert.deepEqual(await alerts(sufficient.id), []);
    const zero = await item(1, 0);
    await request('manager', body(zero, { type: 'OUT' }), 201);
    assert.equal((await alerts(zero.id))[0].currentStock, 0);
    await request('manager', body(zero), 201);
    assert.equal((await alerts(zero.id))[0].status, 'RESOLVED');
  });
  await t.test('replenishment resolves once with session audit; another depletion creates a new period', async () => {
    const row = await item(6, 5);
    await request('manager', body(row, { type: 'OUT' }), 201);
    const [original] = await alerts(row.id);
    await request('manager', body(row, { type: 'OUT', quantity: 2 }), 201);
    await request('manager', body(row, { quantity: 2 }), 201);
    assert.deepEqual(await alerts(row.id), [original]);
    const since = Date.now();
    await request('general', body(row), 201);
    const [resolved] = await alerts(row.id);
    assert.equal(resolved.status, 'RESOLVED'); assert.equal(resolved.resolvedByUserId, users.general.id);
    assert.ok(resolved.resolvedAt.getTime() >= since);
    await request('manager', body(row), 201);
    assert.deepEqual(await alerts(row.id), [resolved]);
    await request('manager', body(row, { type: 'OUT', quantity: 2 }), 201);
    const periods = await alerts(row.id);
    assert.equal(periods.length, 2); assert.deepEqual(periods.find(value => value.id === original.id), resolved);
    assert.equal(periods.filter(value => value.status === 'ACTIVE').length, 1);
    assert.notEqual(periods.find(value => value.status === 'ACTIVE').id, original.id);
    const visible = (await list('manager')).filter(value => value.itemId === row.id);
    assert.equal(visible.length, 2); assert.deepEqual(visible.map(value => value.status).sort(), ['ACTIVE', 'RESOLVED']);
  });
  await t.test('listing isolates branches, exposes no account details and has stable newest-first order', async () => {
    const row = await item(6, 5, otherBranch);
    await request('general', body(row, { type: 'OUT' }), 201);
    const local = await list('manager'), other = await list('otherManager', otherBranch);
    assert.ok(local.length > 0); assert.ok(local.every(value => value.branchId === branch));
    assert.equal(other.length, 1); assert.equal(other[0].itemId, row.id);
    assert.deepEqual(await list('general', otherBranch), other);
    assert.deepEqual(await list('general'), local);
    assert.ok(!JSON.stringify(local).includes('password')); assert.ok(!JSON.stringify(local).includes('@'));
    for (let index = 1; index < local.length; index++) {
      const previous = local[index - 1], current = local[index];
      assert.ok(previous.createdAt > current.createdAt || (previous.createdAt === current.createdAt && previous.id > current.id));
    }
  });
  await t.test('concurrent OUT movements create exactly one ACTIVE alert with no lost stock', async () => {
    const row = await item(12, 10);
    await Promise.all(Array.from({ length: 8 }, () => request('manager', body(row, { type: 'OUT' }), 201)));
    assert.equal((await stock(row.id)).currentStock, 4); assert.equal((await movements(row.id)).length, 8);
    const saved = await alerts(row.id); assert.equal(saved.length, 1); assert.equal(saved[0].currentStock, 10);
  });
  await t.test('concurrent IN movements below minimum create only one alert', async () => {
    const row = await item(0, 10);
    await Promise.all(Array.from({ length: 5 }, () => request('manager', body(row), 201)));
    const saved = await alerts(row.id); assert.equal(saved.length, 1); assert.equal(saved[0].status, 'ACTIVE');
    assert.equal((await stock(row.id)).currentStock, 5);
  });
  await t.test('concurrent replenishment and depletion leave alert state consistent with the committed stock', async () => {
    const row = await item(6, 5);
    await request('manager', body(row, { type: 'OUT' }), 201);
    await Promise.all([request('general', body(row), 201), request('manager', body(row, { type: 'OUT' }), 201)]);
    assert.equal((await stock(row.id)).currentStock, 5);
    const saved = await alerts(row.id); assert.equal(saved.filter(value => value.status === 'ACTIVE').length, 1);
    for (const resolved of saved.filter(value => value.status === 'RESOLVED')) {
      assert.equal(resolved.resolvedByUserId, users.general.id); assert.ok(resolved.resolvedAt);
    }
  });
  await t.test('failed movements do not create or resolve alerts or change stock', async () => {
    const row = await item(2, 5);
    await request('manager', body(row, { type: 'OUT', quantity: 3 }), 400);
    await request('customer', body(row), 403);
    await request('otherManager', body(row), 404);
    await request('manager', body(row, { quantity: 0 }), 400);
    assert.deepEqual(await alerts(row.id), []); assert.equal((await stock(row.id)).currentStock, 2);
    assert.deepEqual(await movements(row.id), []);
  });
  await t.test('alert insertion failure rolls back the stock update and audited movement', async () => {
    const row = await item(6, 5);
    const failingDb = { $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'inventoryAlert') return new Proxy(target.inventoryAlert, {
          get(delegate, method) { if (method === 'create') return async () => { throw new Error('Simulated alert failure'); }; return Reflect.get(delegate, method); },
        });
        return Reflect.get(target, key);
      },
    }))) };
    await assert.rejects(new InventoryMovementsService(failingDb).create(body(row, { type: 'OUT' }),
      { userId: users.manager.id, role: 'MANAGER', branchId: branch }), /Simulated alert failure/);
    assert.equal((await stock(row.id)).currentStock, 6); assert.deepEqual(await movements(row.id), []); assert.deepEqual(await alerts(row.id), []);
  });
  await t.test('partial unique index rejects a duplicate ACTIVE alert', async () => {
    const row = await item(6, 5);
    await request('manager', body(row, { type: 'OUT' }), 201);
    await assert.rejects(db.inventoryAlert.create({ data: { branchId: branch, itemId: row.id, currentStock: 5, minStock: 5 } }), { code: 'P2002' });
    assert.equal((await alerts(row.id)).length, 1);
  });
  await t.test('logged out session cannot read alerts', async () => {
    assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.manager } })).status, 204);
    await list('manager', branch, 401);
  });
});
