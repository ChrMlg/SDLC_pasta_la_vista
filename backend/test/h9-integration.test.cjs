const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { OrderDeliveryService } = require('../dist/orders/order-delivery.service');
const { NotificationsService } = require('../dist/notifications/notifications.service');

test('H9 #40: pickup and deliver orders with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1');
  const db = new PrismaClient(), port = Number(process.env.H9_TEST_PORT || 3333);
  const base = process.env.H9_API_URL || `http://127.0.0.1:${port}/api`, api = new URL(base);
  assert.ok(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname));
  const branches = [randomUUID(), randomUUID()], run = randomUUID(), users = {}, cookies = {}, userIds = [];
  const tables = [], dishes = [];
  let server, serverErrors = '';
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      const branchId = { in: branches }, orders = { branchId }, ticket = { order: orders };
      await db.notification.deleteMany({ where: { userId: { in: userIds } } });
      await db.kitchenTicketLog.deleteMany({ where: { ticket } });
      await db.kitchenTicket.deleteMany({ where: { order: orders } });
      await db.orderItem.deleteMany({ where: { order: orders } });
      await db.order.deleteMany({ where: orders });
      await db.bill.deleteMany({ where: { branchId } });
      await db.menuItem.deleteMany({ where: { branchId } });
      await db.table.deleteMany({ where: { branchId } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: branches } } });
    } finally { await db.$disconnect(); }
  });
  if (!process.env.H9_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverErrors = (serverErrors + data).slice(-12000); });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H9 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H9-${run}-${i}`, name: `Sucursal H9 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role, index] of [['customer','CUSTOMER',null],['waiter','WAITER',0],['kitchen','KITCHEN',0],['secondKitchen','KITCHEN',0],['otherKitchen','KITCHEN',1],['otherWaiter','WAITER',1],['unassigned','KITCHEN',null],['manager','MANAGER',0],['general','GENERAL_MANAGER',null]]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, role, branchId: index === null ? null : branches[index], email: `${label.toLowerCase()}.${run}@h9.invalid`, passwordHash } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  for (const branchId of branches) {
    tables.push(await db.table.create({ data: { branchId, number: 1, capacity: 4, status: 'OCCUPIED' } }));
    dishes.push(await db.menuItem.create({ data: { branchId, name: 'Pasta H9', normalizedName: 'pasta h9', category: 'MAIN_COURSE', price: '10', createdById: users.manager.id } }));
  }
  async function fixture({ index = 0, status = 'PENDING', orderStatus = status, ticket = true, ticketBranch, type = 'DINE_IN', billStatus, creator = 'waiter' } = {}) {
    const [{ number }] = await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
    const bill = billStatus ? await db.bill.create({ data: { branchId: branches[index], type: 'TAKEAWAY', clientId: users.customer.id, status: billStatus, subtotal: '10', tax: '1.30', total: '11.30' } }) : null;
    return db.order.create({ data: { orderNumber: number, branchId: branches[index], type, tableId: type === 'DINE_IN' ? tables[index].id : null,
      createdById: users[creator].id, clientId: users.customer.id, total: '10', status: orderStatus, billId: bill?.id,
      items: { create: [1, 2].map(() => ({ dishId: dishes[index].id, quantity: 1, unitPrice: '5', status: status === 'IN_PREPARATION' ? status : 'PENDING' })) },
      ...(ticket ? { kitchenTicket: { create: { branchId: ticketBranch || branches[index], status } } } : {}),
    }, include: { kitchenTicket: true, items: true } });
  }
  async function request(role, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    if (response.status === 500) console.error('H9 diagnóstico SQL:', serverErrors.match(/(?:code:|Code:)[^\n]*/g)?.slice(-3) || 'Sin código SQLSTATE');
    if (expected !== null) assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${value.code || ''}`);
    if (response.status >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return { status: response.status, value };
  }
  const change = (row, action = 'take', role = 'kitchen', expected = 200, body, branch = branches[0], headers) => request(role, 'PATCH', `/branches/${branch}/kitchen/orders/${typeof row === 'string' ? row : row.id}/${action}`, body, expected, headers);
  const snapshot = id => db.order.findUniqueOrThrow({ where: { id }, include: { kitchenTicket: { include: { logs: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } }, items: { orderBy: { id: 'asc' } } } });
  const notices = id => db.notification.findMany({ where: { eventKey: `order.in_preparation:${id}` }, orderBy: { userId: 'asc' } });
  const session = role => ({ userId: users[role].id, role: users[role].role, branchId: users[role].branchId });
  const delivery = (row, action = 'pickup', role = 'waiter', expected = 200, body, branch = branches[0]) => request(role, 'PATCH', `/branches/${branch}/orders/${typeof row === 'string' ? row : row.id}/${action}`, body, expected);
  const readyOrder = () => fixture({ status: 'READY', billStatus: 'OPEN' });
  await t.test('authentication, roles and branch scope on both endpoints', async () => {
    const row = await readyOrder(), other = await fixture({ index: 1, status: 'READY' });
    for (const action of ['pickup','deliver']) {
      await delivery(row, action, null, 401);
      for (const role of ['customer','kitchen','manager','general','otherWaiter']) await delivery(row, action, role, 403);
      await delivery(row, action, 'waiter', 403, undefined, branches[1]);
      await delivery(other, action, 'waiter', 403);
    }
  });
  await t.test('missing and malformed IDs, forged timestamps and actors', async () => {
    const row = await readyOrder();
    for (const action of ['pickup','deliver']) {
      await delivery(randomUUID(), action, 'waiter', 404);
      await delivery('bad', action, 'waiter', 400);
      for (const body of [{ pickedUpById: users.kitchen.id }, { deliveredAt: '2020-01-01' }, { status: 'DELIVERED' }]) await delivery(row, action, 'waiter', 400, body);
    }
  });
  await t.test('pickup then delivery records authenticated actor and UTC time without changing bill or ticket', async () => {
    const row = await readyOrder();
    const ticketBefore = await db.kitchenTicket.findUnique({ where: { orderId: row.id } });
    const billBefore = await db.bill.findUnique({ where: { id: row.billId } });
    const started = Date.now(), pickup = (await delivery(row)).value;
    assert.deepEqual(Object.keys(pickup).sort(), ['orderId','status','pickedUpAt'].sort());
    assert.equal(pickup.status, 'OUT_FOR_DELIVERY'); assert.ok(pickup.pickedUpAt.endsWith('Z'));
    const delivered = (await delivery(row, 'deliver')).value;
    assert.deepEqual(Object.keys(delivered).sort(), ['orderId','status','deliveredAt'].sort());
    assert.equal(delivered.status, 'DELIVERED'); assert.ok(delivered.deliveredAt.endsWith('Z'));
    const state = await snapshot(row.id);
    assert.equal(state.pickedUpById, users.waiter.id); assert.equal(state.deliveredById, users.waiter.id);
    assert.ok(state.pickedUpAt.getTime() >= started && state.deliveredAt >= state.pickedUpAt && state.deliveredAt.getTime() <= Date.now());
    assert.deepEqual(await db.kitchenTicket.findUnique({ where: { orderId: row.id } }), ticketBefore);
    assert.deepEqual(await db.bill.findUnique({ where: { id: row.billId } }), billBefore);
    for (const event of ['out_for_delivery','delivered']) {
      const rows = await db.notification.findMany({ where: { eventKey: `order.${event}:${row.id}` } });
      assert.deepEqual(rows.map(x => x.userId).sort(), [users.waiter.id, users.customer.id].sort());
      assert.ok(rows.every(x => x.sourceModule === 'ORDERS'));
    }
  });
  await t.test('concurrent pickup and delivery each have one success and one conflict', async () => {
    const row = await readyOrder();
    for (const action of ['pickup','deliver']) {
      const results = await Promise.all([delivery(row, action, 'waiter', null), delivery(row, action, 'waiter', null)]);
      assert.deepEqual(results.map(x => x.status).sort(), [200,409]);
      assert.equal(results.find(x => x.status === 409).value.code, 'INVALID_ORDER_TRANSITION');
    }
    assert.equal(await db.notification.count({ where: { relatedEntityId: row.id } }), 4);
  });
  await t.test('invalid transitions and inconsistent tickets cannot bypass readiness', async () => {
    for (const status of ['PENDING','IN_PREPARATION','OUT_FOR_DELIVERY','DELIVERED','CANCELLED']) {
      const row = await fixture({ status: 'READY', orderStatus: status });
      assert.equal((await delivery(row, 'pickup', 'waiter', 409)).value.code, 'INVALID_ORDER_TRANSITION');
    }
    const row = await readyOrder();
    assert.equal((await delivery(row, 'deliver', 'waiter', 409)).value.code, 'INVALID_ORDER_TRANSITION');
    await delivery(await fixture({ ticket: false, status: 'READY' }), 'pickup', 'waiter', 409);
    await delivery(await fixture({ status: 'IN_PREPARATION', orderStatus: 'READY' }), 'pickup', 'waiter', 409);
    await delivery(await fixture({ status: 'READY', ticketBranch: branches[1] }), 'pickup', 'waiter', 409);
  });
  await t.test('legacy route delegates both transitions and blocks direct delivery', async () => {
    const row = await readyOrder();
    await request('waiter', 'PATCH', `/orders/${row.id}/status/DELIVERED`, undefined, 409);
    await request('waiter', 'PATCH', `/orders/${row.id}/status/OUT_FOR_DELIVERY`);
    await request('waiter', 'PATCH', `/orders/${row.id}/status/DELIVERED`);
    const state = await snapshot(row.id); assert.ok(state.pickedUpAt && state.deliveredAt);
    assert.equal(state.deliveredById, users.waiter.id);
  });
  await t.test('notification failure cannot roll back either transition', async () => {
    const row = await readyOrder();
    const service = new OrderDeliveryService(db, { orderDeliveryCommitted: async () => { throw new Error('notification unavailable'); } });
    await service.change(branches[0], row.id, 'pickup', {}, session('waiter'));
    assert.equal((await snapshot(row.id)).status, 'OUT_FOR_DELIVERY');
    await service.change(branches[0], row.id, 'deliver', {}, session('waiter'));
    assert.equal((await snapshot(row.id)).status, 'DELIVERED');
  });
  await t.test('delayed pickup notice still arrives once after delivery', async () => {
    const row = await readyOrder(), real = new NotificationsService(db);
    const service = new OrderDeliveryService(db, { orderDeliveryCommitted: async () => {} });
    await service.change(branches[0], row.id, 'pickup', {}, session('waiter'));
    await service.change(branches[0], row.id, 'deliver', {}, session('waiter'));
    for (let attempt = 0; attempt < 2; attempt++) await real.orderDeliveryCommitted(row.id, 'OUT_FOR_DELIVERY');
    assert.equal(await db.notification.count({ where: { eventKey: `order.out_for_delivery:${row.id}` } }), 2);
  });
  await t.test('real kitchen flow through H7, H8 and H9 preserves ready items', async () => {
    const row = await fixture();
    await change(row, 'take');
    for (const item of row.items) await request('kitchen', 'PATCH', `/branches/${branches[0]}/kitchen/orders/${row.id}/items/${item.id}/ready`);
    await delivery(row); await delivery(row, 'deliver');
    const state = await snapshot(row.id);
    assert.equal(state.status, 'DELIVERED'); assert.equal(state.kitchenTicket.status, 'READY');
    assert.ok(state.items.every(x => x.isReady && x.readyAt)); assert.ok(state.deliveredAt);
  });
});
