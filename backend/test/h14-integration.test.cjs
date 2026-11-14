const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { InventoryMovementsService } = require('../dist/inventory/inventory-movements.service');

test('H14 #45: transactional inventory movements with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use local PostgreSQL ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H14_TEST_PORT || 3327), base = `http://127.0.0.1:${port}/api`;
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
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  let ready = false, startupError;
  server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || server.exitCode !== null) throw new Error('H14 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: [branch, otherBranch].map((id, i) => ({ id, code: `H14-${run}-${i}`, name: `Sucursal H14 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role, branchId] of [
    ['customer', 'CUSTOMER', null], ['waiter', 'WAITER', branch], ['kitchen', 'KITCHEN', branch],
    ['manager', 'MANAGER', branch], ['otherManager', 'MANAGER', otherBranch], ['unassigned', 'MANAGER', null], ['general', 'GENERAL_MANAGER', null],
  ]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h14.invalid`, passwordHash, role, branchId } });
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
  const baseItem = await item();
  await t.test('no session or forged identity headers returns 401', async () => {
    await request(null, body(baseItem), 401);
    await request(null, body(baseItem), 401, { 'x-role': 'GENERAL_MANAGER', 'x-user-id': users.general.id });
  });
  for (const role of ['customer', 'waiter', 'kitchen']) await t.test(`${role} cannot register movements`, async () => { await request(role, body(baseItem), 403); });
  await t.test('rejects invalid quantities, types, reasons, IDs and injected fields without changing stock', async () => {
    const invalid = [
      ...[0, -1, 1.5, '1', true, null, 2147483648, Number.MAX_SAFE_INTEGER].map(quantity => ({ quantity })),
      ...['', 'in', 'TRANSFER', 1, null].map(type => ({ type })),
      ...['', '  \n\t', 'a'.repeat(201), 5, null].map(reason => ({ reason })),
      { branchId: 'bad' }, { itemId: 'bad' }, { createdById: users.general.id }, { currentStock: 999 }, { status: 'RESOLVED' },
    ];
    for (const changes of invalid) await request('manager', body(baseItem, changes), 400);
    for (const field of ['branchId', 'itemId', 'quantity', 'type', 'reason']) { const input = body(baseItem); delete input[field]; await request('manager', input, 400); }
    for (const input of [null, [], {}]) await request('manager', input, 400);
    assert.equal((await stock(baseItem.id)).currentStock, 10); assert.equal((await movements(baseItem.id)).length, 0);
  });
  await t.test('manager creates an audited IN with trimmed reason and H13 reflects stock', async () => {
    const { value } = await request('manager', body(baseItem, { quantity: 3, reason: '  Compra semanal  ' }), 201);
    assert.deepEqual(Object.keys(value).sort(), ['createdAt','createdById','id','itemId','quantity','reason','type']);
    assert.equal(value.createdById, users.manager.id); assert.equal(value.reason, 'Compra semanal');
    assert.equal(value.itemId, baseItem.id); assert.equal(value.quantity, 3); assert.equal(value.type, 'IN');
    assert.ok(Number.isFinite(Date.parse(value.createdAt)));
    assert.equal((await stock(baseItem.id)).currentStock, 13);
    const response = await fetch(base + `/management/branches/${branch}/inventory`, { headers: { cookie: cookies.manager } });
    assert.equal(response.status, 200); assert.equal((await response.json()).find(row => row.id === baseItem.id).currentStock, 13);
  });
  await t.test('OUT permits exact remaining stock and rejects insufficient stock atomically', async () => {
    const row = await item(4);
    await request('manager', body(row, { type: 'OUT', quantity: 5 }), 400);
    assert.equal((await stock(row.id)).currentStock, 4); assert.equal((await movements(row.id)).length, 0);
    await request('manager', body(row, { type: 'OUT', quantity: 4 }), 201);
    assert.equal((await stock(row.id)).currentStock, 0);
    await request('manager', body(row, { type: 'OUT' }), 400);
    assert.equal((await movements(row.id)).length, 1);
  });
  await t.test('manager cannot target other branch, fake scope or unassigned branch', async () => {
    const row = await item(10, 5, otherBranch);
    await request('manager', body(row), 404);
    await request('manager', body(row, { branchId: branch }), 404);
    await request('manager', body(row), 404, { 'x-branch-id': otherBranch, 'x-role': 'GENERAL_MANAGER' });
    await request('unassigned', body(baseItem), 404);
    await request('otherManager', body(baseItem), 404);
    assert.equal((await stock(row.id)).currentStock, 10); assert.equal((await movements(row.id)).length, 0);
  });
  await t.test('general manager can select either branch; nonexistent or mismatched resources return 404', async () => {
    const row = await item(10, 5, otherBranch);
    await request('general', body(row), 201);
    await request('general', body(baseItem), 201);
    await request('general', body(row, { branchId: branch }), 404);
    await request('general', body(row, { branchId: randomUUID() }), 404);
    await request('general', body(row, { itemId: randomUUID() }), 404);
    assert.equal((await stock(row.id)).currentStock, 11);
  });
  await t.test('reason accepts 200 characters; IDs accept uppercase UUIDs', async () => {
    const row = await item();
    const { value } = await request('manager', body(row, { reason: 'a'.repeat(200), branchId: branch.toUpperCase(), itemId: row.id.toUpperCase() }), 201);
    assert.equal(value.reason.length, 200); assert.equal(value.itemId, row.id);
  });
  await t.test('integer overflow returns 400 without persistence changes', async () => {
    const row = await item(2147483647, 0);
    await request('manager', body(row), 400);
    assert.equal((await stock(row.id)).currentStock, 2147483647); assert.equal((await movements(row.id)).length, 0);
  });
  await t.test('two simultaneous OUT requests cannot spend the same remaining units', async () => {
    const row = await item(5);
    const results = await Promise.all([request('manager', body(row, { type: 'OUT', quantity: 4 })), request('general', body(row, { type: 'OUT', quantity: 4 }))]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 400]);
    assert.equal((await stock(row.id)).currentStock, 1); assert.equal((await movements(row.id)).length, 1);
  });
  await t.test('concurrent IN movements preserve both increments', async () => {
    const row = await item(0);
    await Promise.all([request('manager', body(row, { quantity: 3 }), 201), request('general', body(row, { quantity: 7 }), 201)]);
    assert.equal((await stock(row.id)).currentStock, 10); assert.equal((await movements(row.id)).length, 2);
  });
  await t.test('IN at or below minimum keeps alert active; strictly above resolves with authenticated actor and time', async () => {
    const row = await item(2, 5), other = await item(2, 5);
    const alert = await db.inventoryAlert.create({ data: { branchId: branch, itemId: row.id, currentStock: 2, minStock: 5 } });
    const unrelated = await db.inventoryAlert.create({ data: { branchId: branch, itemId: other.id, currentStock: 2, minStock: 5 } });
    for (const quantity of [1, 2]) {
      await request('manager', body(row, { quantity }), 201);
      assert.equal((await db.inventoryAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'ACTIVE');
    }
    const since = Date.now(); await request('manager', body(row), 201);
    const resolved = await db.inventoryAlert.findUniqueOrThrow({ where: { id: alert.id } });
    assert.equal(resolved.status, 'RESOLVED'); assert.equal(resolved.resolvedByUserId, users.manager.id);
    assert.ok(resolved.resolvedAt.getTime() >= since); assert.equal(resolved.currentStock, 2);
    assert.equal((await db.inventoryAlert.findUniqueOrThrow({ where: { id: unrelated.id } })).status, 'ACTIVE');
    await request('general', body(row), 201);
    assert.deepEqual(await db.inventoryAlert.findUniqueOrThrow({ where: { id: alert.id } }), resolved);
  });
  await t.test('OUT never resolves an active alert', async () => {
    const row = await item(5, 5);
    const alert = await db.inventoryAlert.create({ data: { branchId: branch, itemId: row.id, currentStock: 5, minStock: 5 } });
    await request('manager', body(row, { type: 'OUT' }), 201);
    assert.equal((await db.inventoryAlert.findUniqueOrThrow({ where: { id: alert.id } })).status, 'ACTIVE');
  });
  await t.test('concurrent IN requests resolve once without overwriting resolution audit', async () => {
    const row = await item(5, 5);
    const alert = await db.inventoryAlert.create({ data: { branchId: branch, itemId: row.id, currentStock: 5, minStock: 5 } });
    await Promise.all([request('manager', body(row), 201), request('general', body(row), 201)]);
    const resolved = await db.inventoryAlert.findUniqueOrThrow({ where: { id: alert.id } });
    assert.equal((await stock(row.id)).currentStock, 7); assert.equal((await movements(row.id)).length, 2);
    assert.equal(resolved.status, 'RESOLVED'); assert.ok([users.manager.id, users.general.id].includes(resolved.resolvedByUserId));
  });
  await t.test('failure while resolving alert rolls back stock, movement and alert', async () => {
    const row = await item(5, 5);
    const alert = await db.inventoryAlert.create({ data: { branchId: branch, itemId: row.id, currentStock: 5, minStock: 5 } });
    const failingDb = { $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
      get(target, key) { if (key === 'inventoryAlert') return { updateMany: async () => { throw new Error('Simulated resolution failure'); } }; return Reflect.get(target, key); },
    }))) };
    await assert.rejects(new InventoryMovementsService(failingDb).create(body(row), { userId: users.manager.id, role: 'MANAGER', branchId: branch }), /Simulated resolution failure/);
    assert.equal((await stock(row.id)).currentStock, 5); assert.equal((await movements(row.id)).length, 0);
    assert.deepEqual(await db.inventoryAlert.findUniqueOrThrow({ where: { id: alert.id } }), alert);
  });
  await t.test('foreign key failure in audit rolls back stock update', async () => {
    const row = await item();
    await assert.rejects(new InventoryMovementsService(db).create(body(row), { userId: randomUUID(), role: 'GENERAL_MANAGER' }));
    assert.equal((await stock(row.id)).currentStock, 10); assert.equal((await movements(row.id)).length, 0);
  });
  await t.test('database enforces positive quantity, nonblank reason and one ACTIVE alert per item', async () => {
    const row = await item();
    const data = { itemId: row.id, quantity: 1, type: 'IN', reason: 'Compra', createdById: users.manager.id };
    for (const changes of [{ quantity: 0 }, { quantity: -1 }, { reason: '  ' }, { reason: 'a'.repeat(201) }, { createdById: randomUUID() }])
      await assert.rejects(db.inventoryMovement.create({ data: { ...data, ...changes } }));
    const alert = { itemId: row.id, branchId: branch, currentStock: 1, minStock: 5 };
    await db.inventoryAlert.create({ data: alert });
    await assert.rejects(db.inventoryAlert.create({ data: alert }));
    assert.equal((await movements(row.id)).length, 0);
  });
  await t.test('revoked session cannot mutate inventory', async () => {
    assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.manager } })).status, 204);
    await request('manager', body(baseItem), 401);
  });
});
