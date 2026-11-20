const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { KitchenReadyService } = require('../dist/kitchen/kitchen-ready.service');
const { NotificationsService } = require('../dist/notifications/notifications.service');

test('H8 #39: mark kitchen items ready with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1');
  const db = new PrismaClient(), port = Number(process.env.H8_TEST_PORT || 3332);
  const base = process.env.H8_API_URL || `http://127.0.0.1:${port}/api`, api = new URL(base);
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
  if (!process.env.H8_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverErrors = (serverErrors + data).slice(-12000); });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H8 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H8-${run}-${i}`, name: `Sucursal H8 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role, index] of [['customer','CUSTOMER',null],['waiter','WAITER',0],['kitchen','KITCHEN',0],['secondKitchen','KITCHEN',0],['otherKitchen','KITCHEN',1],['otherWaiter','WAITER',1],['unassigned','KITCHEN',null],['manager','MANAGER',0],['general','GENERAL_MANAGER',null]]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, role, branchId: index === null ? null : branches[index], email: `${label.toLowerCase()}.${run}@h8.invalid`, passwordHash } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  for (const branchId of branches) {
    tables.push(await db.table.create({ data: { branchId, number: 1, capacity: 4, status: 'OCCUPIED' } }));
    dishes.push(await db.menuItem.create({ data: { branchId, name: 'Pasta H8', normalizedName: 'pasta h8', category: 'MAIN_COURSE', price: '10', createdById: users.manager.id } }));
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
    if (response.status === 500) console.error('H8 diagnóstico SQL:', serverErrors.match(/(?:code:|Code:)[^\n]*/g)?.slice(-3) || 'Sin código SQLSTATE');
    if (expected !== null) assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${value.code || ''}`);
    if (response.status >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return { status: response.status, value };
  }
  const change = (row, action = 'take', role = 'kitchen', expected = 200, body, branch = branches[0], headers) => request(role, 'PATCH', `/branches/${branch}/kitchen/orders/${typeof row === 'string' ? row : row.id}/${action}`, body, expected, headers);
  const snapshot = id => db.order.findUniqueOrThrow({ where: { id }, include: { kitchenTicket: { include: { logs: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } }, items: { orderBy: { id: 'asc' } } } });
  const notices = id => db.notification.findMany({ where: { eventKey: `order.in_preparation:${id}` }, orderBy: { userId: 'asc' } });
  const session = role => ({ userId: users[role].id, role: users[role].role, branchId: users[role].branchId });
  const mark = (row, item = row.items[0].id, role = 'kitchen', expected = 200, body, branch = branches[0]) => request(role, 'PATCH', `/branches/${branch}/kitchen/orders/${row.id}/items/${item}/ready`, body, expected);
  const prepared = () => fixture({ status: 'IN_PREPARATION' });
  await t.test('session, roles, branch and input validation', async () => {
    const row = await prepared();
    await mark(row, undefined, null, 401);
    for (const role of ['customer', 'waiter', 'manager', 'general', 'otherKitchen', 'unassigned']) await mark(row, undefined, role, 403);
    await mark(row, undefined, 'kitchen', 403, undefined, branches[1]);
    await mark(row, 'invalid', 'kitchen', 400);
    await mark(row, randomUUID(), 'kitchen', 404);
    await mark(row, undefined, 'kitchen', 400, { readyById: users.waiter.id });
    const other = await prepared(); await mark(row, other.items[0].id, 'kitchen', 404);
    await mark(await fixture({ index: 1, status: 'IN_PREPARATION' }), undefined, 'kitchen', 403);
    await mark(await fixture({ ticketBranch: branches[1], status: 'IN_PREPARATION' }), undefined, 'kitchen', 403);
    await mark(await fixture({ ticket: false, status: 'IN_PREPARATION' }), undefined, 'kitchen', 404);
  });
  await t.test('partial then last item persist actor/time, synchronize READY and notify once per recipient', async () => {
    const row = await prepared(), first = (await mark(row)).value;
    assert.deepEqual(Object.keys(first).sort(), ['itemId','isReady','readyAt','ticketStatus','orderStatus'].sort());
    assert.equal(first.ticketStatus, 'IN_PREPARATION');
    let state = await snapshot(row.id);
    assert.equal(state.items.find(x => x.id === row.items[0].id).readyById, users.kitchen.id);
    assert.equal(await db.notification.count({ where: { eventKey: `order.ready:${row.id}` } }), 0);
    assert.equal((await mark(row, undefined, 'kitchen', 409)).value.code, 'ITEM_ALREADY_READY');
    const results = await Promise.all([mark(row, row.items[1].id, 'kitchen', null), mark(row, row.items[1].id, 'secondKitchen', null)]);
    assert.deepEqual(results.map(x => x.status).sort(), [200,409]);
    state = await snapshot(row.id);
    assert.equal(state.status, 'READY'); assert.equal(state.kitchenTicket.status, 'READY');
    assert.equal(state.kitchenTicket.logs.filter(x => x.action === 'READY').length, 1);
    assert.ok(state.items.every(x => x.isReady && x.readyAt && x.readyById));
    const notices = await db.notification.findMany({ where: { eventKey: `order.ready:${row.id}` } });
    assert.deepEqual(notices.map(x => x.userId).sort(), ['customer','waiter','kitchen','secondKitchen'].map(x => users[x].id).sort());
    assert.ok(notices.every(x => x.sourceModule === 'KITCHEN'));
  });
  await t.test('simultaneous different items both succeed with one READY log', async () => {
    const row = await prepared();
    await Promise.all(row.items.map(item => mark(row, item.id)));
    assert.equal((await snapshot(row.id)).kitchenTicket.logs.length, 1);
  });
  await t.test('wrong states, unpaid orders and cancelled items cannot become ready', async () => {
    for (const status of ['PENDING','READY','CANCELLED']) assert.equal((await mark(await fixture({ status }), undefined, 'kitchen', 409)).value.code, 'TICKET_NOT_IN_PREPARATION');
    await mark(await fixture({ status: 'IN_PREPARATION', type: 'TAKEAWAY', billStatus: 'OPEN' }), undefined, 'kitchen', 409);
    const row = await prepared(); await db.orderItem.update({ where: { id: row.items[0].id }, data: { status: 'CANCELLED' } });
    await mark(row, undefined, 'kitchen', 409);
    assert.equal((await mark(row, row.items[1].id)).value.orderStatus, 'READY');
  });
  await t.test('release racing first ready mark has one winner and coherent state', async () => {
    const row = await prepared();
    const results = await Promise.all([mark(row, undefined, 'kitchen', null), change(row, 'release', 'kitchen', null)]);
    assert.deepEqual(results.map(x => x.status).sort(), [200,409]);
    const state = await snapshot(row.id); assert.equal(state.status, state.kitchenTicket.status);
    assert.equal(state.items.filter(x => x.isReady).length, state.status === 'PENDING' ? 0 : 1);
  });
  await t.test('legacy whole order route uses readiness metadata and audit', async () => {
    const row = await prepared();
    await request('kitchen', 'PATCH', `/orders/${row.id}/status/READY`);
    const state = await snapshot(row.id); assert.ok(state.items.every(x => x.readyAt && x.readyById === users.kitchen.id));
    assert.equal(state.kitchenTicket.logs.length, 1);
  });
  await t.test('audit failure rolls back the item and both statuses', async () => {
    const row = await prepared(); await mark(row);
    const failing = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return callback => target.$transaction(tx => callback(new Proxy(tx, { get(transaction, prop) {
        if (prop === 'kitchenTicketLog') return { create: async () => { throw new Error('audit unavailable'); } };
        const value = transaction[prop]; return typeof value === 'function' ? value.bind(transaction) : value;
      } })));
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const service = new KitchenReadyService(failing, { kitchenStatusCommitted: async () => assert.fail('must not notify') });
    await assert.rejects(service.mark(branches[0], row.id, row.items[1].id, {}, session('kitchen')), /audit unavailable/);
    const state = await snapshot(row.id); assert.equal(state.status, 'IN_PREPARATION'); assert.equal(state.items.filter(x => x.isReady).length, 1);
  });
  await t.test('paid takeaway reaches READY and delayed notification survives delivery', async () => {
    const row = await fixture({ status: 'IN_PREPARATION', type: 'TAKEAWAY', billStatus: 'PAID' });
    const real = new NotificationsService(db);
    const service = new KitchenReadyService(db, { kitchenStatusCommitted: async (orderId, status, logId) => {
      await db.order.update({ where: { id: orderId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      await real.kitchenStatusCommitted(orderId, status, logId);
      await real.kitchenStatusCommitted(orderId, status, logId);
    } });
    await service.mark(branches[0], row.id, null, {}, session('kitchen'));
    assert.equal(await db.notification.count({ where: { eventKey: `order.ready:${row.id}`, userId: users.customer.id } }), 1);
    assert.equal((await snapshot(row.id)).kitchenTicket.status, 'READY');
  });
  await t.test('notification failure after commit keeps READY', async () => {
    const row = await prepared();
    const service = new KitchenReadyService(db, { kitchenStatusCommitted: async () => { throw new Error('notification unavailable'); } });
    await service.mark(branches[0], row.id, null, {}, session('kitchen'));
    assert.equal((await snapshot(row.id)).status, 'READY');
  });
});
