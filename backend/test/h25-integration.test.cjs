const { BranchReviewsService } = require('../dist/reviews/branch-reviews.service');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');

test('H25 #56: branch review listing with local PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1', 'Use the local project connection through run-qa.cjs');
  const db = new PrismaClient();
  const port = Number(process.env.H25_TEST_PORT || 3335);
  const base = process.env.H25_API_URL || `http://127.0.0.1:${port}/api`;
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
      await db.kitchenTicketLog.deleteMany({ where: { ticket: { orderId: { in: orderIds } } } });
      await db.kitchenTicket.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await db.order.deleteMany({ where: { id: { in: orderIds } } });
      await db.receipt.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.payment.deleteMany({ where: { bill: { branchId: { in: [branch, otherBranch] } } } });
      await db.bill.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.receiptCounter.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.menuItem.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.table.deleteMany({ where: { branchId: { in: [branch, otherBranch] } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: [branch, otherBranch] } } });
    } finally { await db.$disconnect(); }
  });
  if (!process.env.H25_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H25 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: [branch, otherBranch].map((id, i) => ({ id, code: `H25-${run}-${i}`, name: `Sucursal H25 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role] of [['customer', 'CUSTOMER'], ['otherCustomer', 'CUSTOMER'], ['waiter', 'WAITER'], ['kitchen', 'KITCHEN'], ['manager', 'MANAGER'], ['general', 'GENERAL_MANAGER']]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h25.invalid`, passwordHash, role, branchId: ['CUSTOMER', 'GENERAL_MANAGER'].includes(role) ? null : branch } });
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
  const list = (id = branch, query = '', role = 'customer', expected = 200, headers = {}) => call(role, 'GET', `/branches/${id}/reviews${query}`, undefined, expected, headers);
  const addReview = async (rating, createdAt, branchId = branch) => {
    const row = await order({ branchId });
    return db.review.create({ data: { orderId: row.id, clientId: users.customer.id, branchId, rating, comment: rating === 1 ? null : 'Reseña de prueba', createdAt: new Date(createdAt) } });
  };
  await t.test('session required, kitchen denied and identity headers ignored', async () => {
    await list(branch, '', null, 401, { 'x-role': 'CUSTOMER', 'x-user-id': users.customer.id });
    await list(branch, '', 'kitchen', 403);
  });
  await t.test('staff scope, missing branches and customer/general access', async () => {
    for (const role of ['waiter','manager']) {
      await list(branch, '', role);
      assert.deepEqual((await list(otherBranch, '', role, 404)).value, (await list(randomUUID(), '', role, 404)).value);
      await db.user.update({ where: { id: users[role].id }, data: { branchId: null } });
      try { await list(branch, '', role, 404); }
      finally { await db.user.update({ where: { id: users[role].id }, data: { branchId: branch } }); }
    }
    for (const role of ['customer','general']) {
      await list(otherBranch, '', role); await list(randomUUID(), '', role, 404);
    }
    await list('invalid', '', 'customer', 400);
  });
  await t.test('empty branch and default pagination contract', async () => {
    assert.deepEqual((await list(branch.toUpperCase())).value, { data: [], total: 0, page: 1, pageSize: 10 });
  });
  await t.test('invalid rating/page and extra or repeated parameters return 400', async () => {
    for (const query of ['?rating=0','?rating=6','?rating=2.5','?rating=x','?rating=',
      '?page=0','?page=-1','?page=1.5','?page=','?page=1e2','?page=9007199254740992',
      '?rating=1&rating=2','?page=1&page=2','?page[x]=1','?pageSize=100', '?branchId='+otherBranch])
      await list(branch, query, 'customer', 400);
  });
  const reviews = [];
  for (let i = 0; i < 23; i++) reviews.push(await addReview(i % 5 + 1, i < 12 ? '2030-01-02T12:00:00Z' : '2030-01-01T12:00:00Z'));
  await addReview(5, '2031-01-01T12:00:00Z', otherBranch);
  const ordered = [...reviews].sort((a,b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  await t.test('stable date descending/id ascending order across pages of ten, without branch leaks', async () => {
    const collected = [];
    for (const page of [1,2,3,4]) {
      const data = (await list(branch, '?page='+page)).value;
      assert.deepEqual(Object.keys(data).sort(), ['data','page','pageSize','total']);
      assert.equal(data.total, 23); assert.equal(data.page, page); assert.equal(data.pageSize, 10);
      assert.deepEqual(data.data.map(x => x.id), ordered.slice((page-1)*10,page*10).map(x => x.id));
      collected.push(...data.data.map(x => x.id));
    }
    assert.equal(new Set(collected).size, 23);
    assert.equal((await list(branch, '?page=1000000000')).value.data.length, 0);
    assert.equal((await list(otherBranch)).value.total, 1);
  });
  await t.test('public projection excludes author/order/branch IDs, email and profile fields for every role', async () => {
    await db.user.update({ where: { id: users.customer.id }, data: { firstName: 'Nombre privado', lastName: 'Apellido privado', phone: '77778888' } });
    for (const role of ['customer','waiter','manager','general']) {
      const response = (await list(branch, '', role)).value;
      for (const row of response.data) assert.deepEqual(Object.keys(row).sort(), ['comment','createdAt','id','rating']);
      const serialized = JSON.stringify(response);
      for (const secret of [users.customer.email, users.customer.id, 'Nombre privado', '77778888']) assert.ok(!serialized.includes(secret));
    }
  });
  await t.test('exact rating filter affects both total and rows and accepts all ratings', async () => {
    for (let rating = 1; rating <= 5; rating++) {
      const expected = ordered.filter(x => x.rating === rating), data = (await list(branch, '?rating='+rating)).value;
      assert.equal(data.total, expected.length); assert.deepEqual(data.data.map(x => x.id), expected.map(x => x.id));
      assert.equal((await list(branch, '?rating='+rating+'&page=2')).value.data.length, 0);
    }
  });
  await t.test('a concurrent insert cannot make rows disagree with total within one response', async () => {
    let inserted;
    const wrapped = { $transaction: (callback, options) => db.$transaction(tx => callback(new Proxy(tx, { get(target, prop) {
      if (prop === 'review') return new Proxy(target.review, { get(delegate, method) {
        if (method === 'count') return async args => { const count = await delegate.count(args); inserted = await addReview(5, '2032-01-01T12:00:00Z'); return count; };
        return Reflect.get(delegate, method);
      } });
      return Reflect.get(target, prop);
    } })), options) };
    const response = await new BranchReviewsService(wrapped).list(branch, {}, { userId: users.customer.id, role: 'CUSTOMER', branchId: null });
    assert.equal(response.total, 23); assert.deepEqual(response.data.map(x => x.id), ordered.slice(0,10).map(x => x.id));
    const fresh = (await list()).value; assert.equal(fresh.total, 24); assert.equal(fresh.data[0].id, inserted.id);
  });
  await t.test('H23 creation becomes visible; reads and unsupported updates/deletes preserve review', async () => {
    const row = await order(), created = (await post(row.id, { rating: 4, comment: 'Reseña creada por API' })).value;
    const before = await db.review.findUnique({ where: { id: created.id } });
    for (const method of ['PATCH','PUT','DELETE']) {
      await call('customer', method, `/branches/${branch}/reviews/${created.id}`, { rating: 1 }, 404);
      await call('customer', method, `/orders/${row.id}/reviews`, { rating: 1 }, 404);
    }
    const filtered = (await list(branch, '?rating=4')).value;
    assert.ok(filtered.data.some(x => x.id === created.id));
    assert.deepEqual(await db.review.findUnique({ where: { id: created.id } }), before);
  });
  await t.test('logout revokes access to the list', async () => {
    assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.customer } })).status, 204);
    await list(branch, '', 'customer', 401);
  });
});
