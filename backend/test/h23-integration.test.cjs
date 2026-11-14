const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { ReviewsService } = require('../dist/reviews/reviews.service');
const { REVIEW_WINDOW_MS } = require('../dist/reviews/review-rules');

test('H23 #54: customer reviews with local PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use local PostgreSQL ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H23_TEST_PORT || 3329);
  const base = process.env.H23_API_URL || `http://127.0.0.1:${port}/api`;
  const api = new URL(base);
  assert.ok(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname), 'Use only the local API');
  const branch = randomUUID(), otherBranch = randomUUID(), run = randomUUID();
  const users = {}, cookies = {}, userIds = [], orderIds = [];
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      await db.review.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.notification.deleteMany({ where: { userId: { in: userIds } } });
      await db.orderLinkCode.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.kitchenTicket.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
      await db.menuItem.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.table.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: [branch, otherBranch] } } });
    } finally { await db.$disconnect(); }
  });
  if (!process.env.H23_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H23 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: [branch, otherBranch].map((id, i) => ({ id, code: `H23-${run}-${i}`, name: `Sucursal H23 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role] of [['customer', 'CUSTOMER'], ['otherCustomer', 'CUSTOMER'], ['waiter', 'WAITER'], ['kitchen', 'KITCHEN'], ['manager', 'MANAGER'], ['general', 'GENERAL_MANAGER']]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h23.invalid`, passwordHash, role, branchId: ['CUSTOMER', 'GENERAL_MANAGER'].includes(role) ? null : branch } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  async function order(changes = {}) {
    const id = randomUUID(); orderIds.push(id);
    const [{ number }] = await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
    return db.order.create({ data: { id, orderNumber: number, branchId: branch, createdById: users.customer.id,
      clientId: users.customer.id, clientLinkedAt: new Date(), type: 'TAKEAWAY', total: '10.00',
      status: 'DELIVERED', deliveredAt: new Date(Date.now() - 60000), ...changes } });
  }
  async function call(role, method, route, body, expected, headers = {}) {
    const response = await fetch(base + route, { method,
      headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    if (expected !== undefined) assert.equal(response.status, expected, `${method}: ${response.status} ${value.code || ''}`);
    if (response.status >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return { status: response.status, value };
  }
  const get = (id, role = 'customer', expected = 200, headers = {}) => call(role, 'GET', `/orders/${id}/review-eligibility`, undefined, expected, headers);
  const post = (id, body = { rating: 5 }, role = 'customer', expected = 201, headers = {}) => call(role, 'POST', `/orders/${id}/reviews`, body, expected === null ? undefined : expected, headers);
  const eligible = await order();
  await t.test('verified session is mandatory; forged identity headers are ignored', async () => {
    await get(eligible.id, null, 401); await post(eligible.id, { rating: 5 }, null, 401);
    await get(eligible.id, null, 401, { 'x-user-id': users.customer.id, 'x-role': 'CUSTOMER' });
    await post(eligible.id, { rating: 5 }, 'otherCustomer', 404, { 'x-user-id': users.customer.id });
  });
  for (const role of ['waiter', 'kitchen', 'manager', 'general']) await t.test(`${role} cannot access either endpoint`, async () => {
    await get(eligible.id, role, 403); await post(eligible.id, { rating: 5 }, role, 403);
  });
  await t.test('missing and another customer orders return indistinguishable 404 errors', async () => {
    assert.deepEqual((await get(randomUUID(), 'customer', 404)).value, (await get(eligible.id, 'otherCustomer', 404)).value);
    await post(randomUUID(), { rating: 5 }, 'customer', 404);
    await post(eligible.id, { rating: 5 }, 'otherCustomer', 404);
  });
  await t.test('invalid IDs, body types, ratings, comments and identity injection are rejected without writes', async () => {
    await get('invalid', 'customer', 400); await post('invalid', { rating: 5 }, 'customer', 400);
    const bad = [[], {}, { rating: 0 }, { rating: 6 }, { rating: 1.5 }, { rating: '5' }, { rating: true }, { rating: null },
      { rating: 5, comment: 'a'.repeat(501) }, { rating: 5, comment: 5 }, { rating: 5, comment: {} },
      ...['clientId', 'branchId', 'orderId', 'createdAt', 'updatedAt', 'status'].map(key => ({ rating: 5, [key]: randomUUID() }))];
    for (const body of bad) await post(eligible.id, body, 'customer', 400);
    await get(eligible.id + '/bad', 'customer', 404);
    await call('customer', 'GET', `/orders/${eligible.id}/review-eligibility?clientId=${users.otherCustomer.id}`, undefined, 400);
    assert.equal(await db.review.count({ where: { orderId: eligible.id } }), 0);
  });
  await t.test('eligibility exposes only the specified contract and does not create a review', async () => {
    const { value } = await get(eligible.id.toUpperCase());
    assert.deepEqual(value, { orderId: eligible.id, branchId: branch, status: 'DELIVERED', deliveredAt: eligible.deliveredAt.toISOString(), canReview: true, reason: null });
    assert.equal(await db.review.count({ where: { orderId: eligible.id } }), 0);
  });
  await t.test('non-delivered orders are ineligible and cannot be reviewed', async () => {
    for (const status of ['PENDING', 'IN_PREPARATION', 'READY', 'OUT_FOR_DELIVERY', 'CANCELLED']) {
      const row = await order({ status });
      const info = (await get(row.id)).value; assert.equal(info.canReview, false); assert.equal(typeof info.reason, 'string');
      assert.equal((await post(row.id, { rating: 5 }, 'customer', 409)).value.code, 'ORDER_NOT_DELIVERED');
    }
  });
  await t.test('missing delivery date, future date and expired window return 409 on submission', async () => {
    for (const deliveredAt of [null, new Date(Date.now() + 3600000), new Date(Date.now() - REVIEW_WINDOW_MS - 1000)]) {
      const row = await order({ deliveredAt }); assert.equal((await get(row.id)).value.canReview, false);
      await post(row.id, { rating: 5 }, 'customer', 409);
      assert.equal(await db.review.count({ where: { orderId: row.id } }), 0);
    }
  });
  await t.test('unlinked orders return 409 without exposing order details', async () => {
    const row = await order({ clientId: null, clientLinkedAt: null, createdById: users.waiter.id });
    assert.equal((await get(row.id, 'customer', 409)).value.code, 'ORDER_NOT_LINKED');
    await post(row.id, { rating: 5 }, 'customer', 409);
  });
  await t.test('valid review derives author and branch and returns exactly the issue contract', async () => {
    const row = await order({ branchId: otherBranch }), before = Date.now();
    const { value } = await post(row.id.toUpperCase(), { rating: 4, comment: 'Buena atención y comida.' });
    assert.deepEqual(Object.keys(value).sort(), ['branchId', 'clientId', 'comment', 'createdAt', 'id', 'orderId', 'rating']);
    assert.equal(value.clientId, users.customer.id); assert.equal(value.branchId, otherBranch); assert.equal(value.orderId, row.id);
    assert.equal(value.rating, 4); assert.equal(value.comment, 'Buena atención y comida.'); assert.ok(Date.parse(value.createdAt) >= before);
    const saved = await db.review.findUniqueOrThrow({ where: { orderId: row.id } }); assert.equal(saved.id, value.id); assert.ok(saved.updatedAt);
    assert.equal((await get(row.id)).value.canReview, false);
    const duplicate = await post(row.id, { rating: 1 }, 'customer', 409);
    assert.equal(duplicate.value.message, 'Este pedido ya tiene una reseña');
    for (const method of ['PUT', 'PATCH', 'DELETE'])
      await call('customer', method, `/orders/${row.id}/reviews`, { rating: 1 }, 404);
    assert.deepEqual(await db.review.findUnique({ where: { orderId: row.id } }), saved);
  });
  await t.test('rating limits and optional, null, empty or 500-character comments are accepted', async () => {
    for (const body of [{ rating: 1 }, { rating: 5, comment: null }, { rating: 3, comment: '' }, { rating: 5, comment: 'á'.repeat(500) }]) {
      const row = await order(); const { value } = await post(row.id, body);
      assert.equal(value.comment, body.comment ?? null); assert.equal(value.rating, body.rating);
    }
  });
  await t.test('concurrent submissions create exactly one review and return 409 to the rest', async () => {
    const row = await order();
    const results = await Promise.all(Array.from({ length: 6 }, () => post(row.id, { rating: 5 }, 'customer', null)));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409, 409, 409, 409]);
    assert.equal(await db.review.count({ where: { orderId: row.id } }), 1);
  });
  await t.test('eligibility is rechecked at submission instead of trusting an earlier GET', async () => {
    const row = await order(); assert.equal((await get(row.id)).value.canReview, true);
    await db.order.update({ where: { id: row.id }, data: { deliveredAt: new Date(Date.now() - REVIEW_WINDOW_MS - 1000) } });
    assert.equal((await post(row.id, { rating: 5 }, 'customer', 409)).value.code, 'REVIEW_WINDOW_EXPIRED');
  });
  await t.test('transaction rollback removes an inserted review if the write fails afterwards', async () => {
    const row = await order();
    const failingDb = { $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
      get(target, key) {
        if (key === 'review') return new Proxy(target.review, { get(delegate, method) {
          if (method === 'create') return async args => { await delegate.create(args); throw new Error('Simulated failure'); };
          return Reflect.get(delegate, method);
        } });
        return Reflect.get(target, key);
      },
    }))) };
    await assert.rejects(new ReviewsService(failingDb).create(row.id, { rating: 5 }, { userId: users.customer.id, role: 'CUSTOMER', branchId: null }), /Simulated failure/);
    assert.equal(await db.review.count({ where: { orderId: row.id } }), 0);
    assert.deepEqual(await db.order.findUnique({ where: { id: row.id } }), row);
  });
  await t.test('database rejects invalid ratings, oversize comments and duplicate order reviews', async () => {
    const row = await order(), data = { orderId: row.id, clientId: users.customer.id, branchId: branch, rating: 5 };
    for (const rating of [0, 6]) await assert.rejects(db.review.create({ data: { ...data, rating } }));
    await assert.rejects(db.review.create({ data: { ...data, comment: 'a'.repeat(501) } }));
    await db.review.create({ data }); await assert.rejects(db.review.create({ data }), { code: 'P2002' });
  });
  await t.test('customer self-service order is already linked; delivered fixture can be reviewed without a code', async () => {
    const dish = await db.menuItem.create({ data: { branchId: branch, name: 'Platillo H23', normalizedName: 'platillo h23', category: 'MAIN_COURSE', price: '10', createdById: users.manager.id } });
    const { value } = await call('customer', 'POST', '/orders/customer', { branchId: branch, type: 'TAKEAWAY', items: [{ dishId: dish.id, quantity: 1 }] }, 201);
    orderIds.push(value.id);
    const saved = await db.order.findUniqueOrThrow({ where: { id: value.id } }); assert.equal(saved.clientId, users.customer.id);
    assert.equal((await get(value.id)).value.canReview, false);
    // Cocina todavía pendiente: solo este pedido temporal simula su estado final.
    await db.order.update({ where: { id: value.id }, data: { status: 'DELIVERED', deliveredAt: new Date(Date.now() - 1000) } });
    await post(value.id);
  });
  await t.test('waiter order requires existing link-code confirmation before review', async () => {
    const table = await db.table.create({ data: { branchId: branch, number: 1, status: 'OCCUPIED', capacity: 4 } });
    const row = await order({ createdById: users.waiter.id, type: 'DINE_IN', tableId: table.id, clientId: null, clientLinkedAt: null });
    await post(row.id, { rating: 5 }, 'customer', 409);
    const { value } = await call('waiter', 'POST', `/orders/${row.id}/link-code`, {}, 201);
    await call('customer', 'POST', '/orders/link-code/confirm', { code: value.code }, 201);
    assert.equal((await get(row.id)).value.canReview, true); await post(row.id);
    await post(row.id, { rating: 5 }, 'otherCustomer', 404);
  });
  await t.test('logged out session cannot read or submit reviews', async () => {
    assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.customer } })).status, 204);
    await get(eligible.id, 'customer', 401); await post(eligible.id, { rating: 5 }, 'customer', 401);
  });
});
