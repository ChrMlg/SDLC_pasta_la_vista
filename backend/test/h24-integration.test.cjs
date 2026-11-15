const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');

test('H24 #55: branch rating summaries with local PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use local PostgreSQL ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H24_TEST_PORT || 3334);
  const base = process.env.H24_API_URL || `http://127.0.0.1:${port}/api`;
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
  if (!process.env.H24_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H24 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: [branch, otherBranch].map((id, i) => ({ id, code: `H24-${run}-${i}`, name: `Sucursal H24 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role] of [['customer', 'CUSTOMER'], ['otherCustomer', 'CUSTOMER'], ['waiter', 'WAITER'], ['kitchen', 'KITCHEN'], ['manager', 'MANAGER'], ['general', 'GENERAL_MANAGER']]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h24.invalid`, passwordHash, role, branchId: ['CUSTOMER', 'GENERAL_MANAGER'].includes(role) ? null : branch } });
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
  const summary = (id = branch, query = '', role = 'manager', expected = 200, headers = {}) => call(role, 'GET', `/management/branches/${id}/ratings/summary${query}`, undefined, expected, headers);
  const addReview = async (rating, createdAt, branchId = branch) => {
    const row = await order({ branchId });
    return db.review.create({ data: { orderId: row.id, clientId: users.customer.id, branchId, rating, createdAt: new Date(createdAt) } });
  };
  await t.test('authentication and forbidden roles; identity headers cannot bypass session', async () => {
    await summary(branch, '', null, 401, { 'x-role': 'MANAGER', 'x-user-id': users.manager.id });
    for (const role of ['customer','waiter','kitchen']) await summary(branch, '', role, 403);
  });
  await t.test('manager scope conceals other branches; general manager can select any existing branch', async () => {
    const denied = await summary(otherBranch, '', 'manager', 404);
    assert.deepEqual(denied.value, (await summary(randomUUID(), '', 'manager', 404)).value);
    assert.deepEqual((await summary(otherBranch, '', 'general')).value, { branchId: otherBranch, averageRating: null, reviewCount: 0 });
    await summary(randomUUID(), '', 'general', 404);
    await summary('invalid', '', 'general', 400);
    await db.user.update({ where: { id: users.manager.id }, data: { branchId: null } });
    try { await summary(branch, '', 'manager', 404); }
    finally { await db.user.update({ where: { id: users.manager.id }, data: { branchId: branch } }); }
  });
  await t.test('empty branch returns null and zero with exact response shape', async () => {
    assert.deepEqual((await summary(branch.toUpperCase())).value, { branchId: branch, averageRating: null, reviewCount: 0 });
  });
  await t.test('date pairs, real dates, ordering, duplicate and unknown query parameters are validated', async () => {
    for (const query of ['?dateFrom=2026-01-01','?dateTo=2026-01-01','?dateFrom=&dateTo=',
      '?dateFrom=2026-02-30&dateTo=2026-03-01','?dateFrom=2026-01-02&dateTo=2026-01-01',
      '?dateFrom=2026-1-1&dateTo=2026-01-02','?dateFrom=2026-01-01T00:00:00Z&dateTo=2026-01-02',
      '?dateFrom=2026-01-01&dateFrom=2026-01-02&dateTo=2026-01-03','?branchId='+otherBranch,
      '?dateFrom[x]=2026-01-01&dateTo=2026-01-02']) await summary(branch, query, 'manager', 400);
    await summary(branch, '?dateFrom=2024-02-29&dateTo=2024-02-29');
  });
  await t.test('local-day boundaries include final milliseconds and exclude other branches', async () => {
    await addReview(1, '2030-02-15T05:59:59.999Z');
    await addReview(2, '2030-02-15T06:00:00.000Z');
    await addReview(5, '2030-02-16T05:59:59.999Z');
    await addReview(1, '2030-02-16T06:00:00.000Z');
    await addReview(1, '2030-02-15T12:00:00.000Z', otherBranch);
    const query = '?dateFrom=2030-02-15&dateTo=2030-02-15';
    assert.deepEqual((await summary(branch, query)).value, { branchId: branch, averageRating: 3.5, reviewCount: 2 });
    assert.deepEqual((await summary(branch, query, 'general')).value, { branchId: branch, averageRating: 3.5, reviewCount: 2 });
    assert.deepEqual((await summary(otherBranch, query, 'general')).value, { branchId: otherBranch, averageRating: 1, reviewCount: 1 });
    assert.deepEqual((await summary(branch, '?dateFrom=2031-01-01&dateTo=2031-01-02')).value, { branchId: branch, averageRating: null, reviewCount: 0 });
  });
  await t.test('unfiltered summary uses all reviews; decimal averages round to one place', async () => {
    assert.deepEqual((await summary()).value, { branchId: branch, averageRating: 2.3, reviewCount: 4 });
    await addReview(5, '2030-03-01T06:00:00Z');
    await addReview(5, '2030-03-02T06:00:00Z');
    await addReview(4, '2030-03-03T06:00:00Z');
    assert.equal((await summary(branch, '?dateFrom=2030-03-01&dateTo=2030-03-03')).value.averageRating, 4.7);
  });
  await t.test('new H23 review appears immediately without persisted averages or mutations on reads', async () => {
    const before = (await summary()).value;
    const row = await order(); await post(row.id, { rating: 3 });
    const aggregate = await db.review.aggregate({ where: { branchId: branch }, _sum: { rating: true }, _count: { _all: true } });
    const reviewsBefore = await db.review.findMany({ where: { branchId: branch }, orderBy: { id: 'asc' } });
    const result = (await summary()).value;
    assert.equal(result.reviewCount, before.reviewCount + 1);
    assert.equal(result.averageRating, Math.round(aggregate._sum.rating / aggregate._count._all * 10) / 10);
    assert.deepEqual(await db.review.findMany({ where: { branchId: branch }, orderBy: { id: 'asc' } }), reviewsBefore);
  });
  await t.test('logged out manager cannot read the summary', async () => {
    assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.manager } })).status, 204);
    await summary(branch, '', 'manager', 401);
  });
});
