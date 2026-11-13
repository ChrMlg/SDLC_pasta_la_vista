const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { localParts, timeMinutes, formatMinutes } = require('../dist/common/local-time');
const { CustomerReservationsService } = require('../dist/reservations/customer-reservations.service');
const { ReservationCancellationService } = require('../dist/reservations/reservation-cancellation.service');

test('H12 #43: customer reservations with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use a local PostgreSQL database ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H12_TEST_PORT || 3325);
  const base = `http://127.0.0.1:${port}/api`;
  const branches = [randomUUID(), randomUUID()];
  const [branch, otherBranch] = branches;
  const userIds = [], users = {}, cookies = {};
  const run = randomUUID();
  const date = localParts(new Date(Date.now() + 7 * 86400000)).date;
  const nextDate = localParts(new Date(Date.now() + 8 * 86400000)).date;
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      await db.notification.deleteMany({ where: { userId: { in: userIds } } });
      await db.reservation.deleteMany({ where: { branchId: { in: branches } } });
      await db.table.deleteMany({ where: { branchId: { in: branches } } });
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
    if (startupError || server.exitCode !== null) throw new Error('H12 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'H12 API starts within 10 seconds');
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H12-${run}-${i}`, name: `Sucursal H12 ${i}` })) });
  const table = await db.table.create({ data: { branchId: branch, number: 1, capacity: 4 } });
  const otherTable = await db.table.create({ data: { branchId: otherBranch, number: 1, capacity: 4, status: 'OCCUPIED' } });
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(password);
  async function request(role, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(base + route, { method, headers: {
      'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${response.status}, ${value.code || ''}`);
    if (expected >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return value;
  }
  for (const [label, role] of [['customer', 'CUSTOMER'], ['otherCustomer', 'CUSTOMER'], ['emptyCustomer', 'CUSTOMER'],
    ['waiter', 'WAITER'], ['kitchen', 'KITCHEN'], ['manager', 'MANAGER'], ['general', 'GENERAL_MANAGER']]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h12.invalid`, passwordHash, role,
      branchId: ['CUSTOMER', 'GENERAL_MANAGER'].includes(role) ? null : branch } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200);
    cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  const list = '/me/reservations';
  const cancel = id => `${list}/${id}/cancel`;
  async function reserve(changes = {}) {
    return db.reservation.create({ data: { branchId: branch, tableId: table.id, customerId: users.customer.id,
      date, startTime: '12:00', endTime: '13:30', partySize: 2, ...changes } });
  }
  // Fixtures de historial, no creados mediante reglas de fechas futuras de H10.
  const future = await reserve({ date: nextDate });
  const past = await reserve({ date: '2020-01-02' });
  const pending = await reserve({ status: 'PENDING', updatedAt: new Date('2020-01-01T00:00:00Z') });
  const cancelled = await reserve({ startTime: '14:00', endTime: '15:30', status: 'CANCELLED' });
  const secondBranch = await reserve({ branchId: otherBranch, tableId: otherTable.id });
  const foreign = await reserve({ customerId: users.otherCustomer.id, date: nextDate, startTime: '16:00', endTime: '17:30' });
  const ownIds = [future, past, pending, cancelled, secondBranch].map(r => r.id);

  await t.test('both routes reject missing, forged and revoked sessions', async () => {
    await request(null, 'GET', list, undefined, 401);
    await request(null, 'PUT', cancel(pending.id), {}, 401);
    await request(null, 'GET', list, undefined, 401, { 'x-role': 'CUSTOMER', 'x-user-id': users.customer.id });
    const logout = await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies.emptyCustomer } });
    assert.equal(logout.status, 204);
    await request('emptyCustomer', 'GET', list, undefined, 401);
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: users.emptyCustomer.email, password }) });
    assert.equal(response.status, 200); cookies.emptyCustomer = response.headers.get('set-cookie').split(';')[0];
  });
  for (const role of ['waiter', 'kitchen', 'manager', 'general']) await t.test(`${role} cannot use customer reservation routes`, async () => {
    await request(role, 'GET', list, undefined, 403);
    await request(role, 'PUT', cancel(pending.id), {}, 403);
  });
  await t.test('lists only own reservations across branches, including past and cancelled, in stable chronological order', async () => {
    const value = await request('customer', 'GET', list);
    assert.deepEqual(value.map(r => r.id).sort(), ownIds.slice().sort());
    const expected = [future, past, pending, cancelled, secondBranch].sort((a, b) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
    assert.deepEqual(value.map(r => r.id), expected.map(r => r.id));
    assert.equal(value.find(r => r.id === secondBranch.id).branchName, 'Sucursal H12 1');
    assert.ok(value.every(r => r.tableNumber === 1));
    const fields = ['id','branchId','branchName','tableId','tableNumber','date','startTime','endTime','partySize','status','createdAt','updatedAt'].sort();
    assert.ok(value.every(r => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(fields)));
    assert.deepEqual((await request('otherCustomer', 'GET', list)).map(r => r.id), [foreign.id]);
  });
  await t.test('customer without reservations receives an empty list', async () => {
    assert.deepEqual(await request('emptyCustomer', 'GET', list), []);
  });
  await t.test('rejects identity, branch and state injection instead of using client filters', async () => {
    for (const query of [`customerId=${users.otherCustomer.id}`, `branchId=${otherBranch}`, 'status=CONFIRMED', 'page=1'])
      await request('customer', 'GET', `${list}?${query}`, undefined, 400);
    for (const body of [{ customerId: users.otherCustomer.id }, { branchId: branch }, { status: 'CANCELLED' }, []])
      await request('customer', 'PUT', cancel(pending.id), body, 400);
    await request('customer', 'PUT', cancel('invalid'), {}, 400);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: pending.id } })).status, 'PENDING');
  });
  await t.test('foreign reservation is 403, missing reservation is 404 and neither creates notifications', async () => {
    await request('customer', 'PUT', cancel(foreign.id), {}, 403);
    await request('customer', 'PUT', cancel(randomUUID()), {}, 404);
    await request('otherCustomer', 'PUT', cancel(past.id), {}, 403);
    await request('otherCustomer', 'PUT', cancel(cancelled.id), {}, 403);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: foreign.id } })).status, 'CONFIRMED');
    assert.equal(await db.notification.count({ where: { userId: { in: userIds } } }), 0);
  });
  await t.test('expired deadline returns 400 without changing state or timestamps', async () => {
    const today = localParts(new Date());
    const start = Math.min(timeMinutes(today.time) + 60, 22 * 60);
    const late = await reserve({ date: today.date, startTime: formatMinutes(start), endTime: formatMinutes(start + 90) });
    for (const target of [late, past]) {
      const result = await request('customer', 'PUT', cancel(target.id), {}, 400);
      assert.equal(result.code, 'CANCELLATION_DEADLINE_PASSED');
      const saved = await db.reservation.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(saved.status, target.status); assert.equal(saved.updatedAt.getTime(), target.updatedAt.getTime());
      assert.equal(await db.notification.count({ where: { relatedEntityId: target.id } }), 0);
    }
  });
  await t.test('cancels own PENDING reservation and updates timestamp and subsequent listing', async () => {
    const value = await request('customer', 'PUT', cancel(pending.id));
    assert.equal(value.status, 'CANCELLED'); assert.equal(value.customerId, users.customer.id);
    assert.ok(new Date(value.updatedAt) > pending.updatedAt);
    assert.equal((await request('customer', 'GET', list)).find(r => r.id === pending.id).status, 'CANCELLED');
  });
  await t.test('customer can cancel own reservation in any branch without changing the operational table state', async () => {
    const value = await request('customer', 'PUT', cancel(secondBranch.id), {});
    assert.equal(value.branchId, otherBranch); assert.equal(value.status, 'CANCELLED');
    assert.equal((await db.table.findUniqueOrThrow({ where: { id: otherTable.id } })).status, 'OCCUPIED');
  });
  await t.test('cancellation notice is sent to the owner once; repeated cancellation is 400', async () => {
    const notices = await db.notification.findMany({ where: { relatedEntityId: pending.id } });
    assert.equal(notices.length, 1); assert.equal(notices[0].userId, users.customer.id);
    assert.equal(notices[0].eventKey, `reservation.cancelled:${pending.id}`);
    const ownInbox = await request('customer', 'GET', '/notifications?sourceModule=RESERVATIONS');
    assert.ok(ownInbox.data.some(n => n.relatedEntityId === pending.id));
    assert.equal((await request('otherCustomer', 'GET', '/notifications?sourceModule=RESERVATIONS')).total, 0);
    const value = await request('customer', 'PUT', cancel(pending.id), {}, 400);
    assert.equal(value.code, 'RESERVATION_ALREADY_CANCELLED');
    assert.equal(await db.notification.count({ where: { relatedEntityId: pending.id } }), 1);
  });
  await t.test('concurrent customer cancellations produce a single success and a single notice', async () => {
    const target = await reserve({ date: nextDate, startTime: '18:00', endTime: '19:30' });
    const responses = await Promise.all([0, 1].map(() => fetch(base + cancel(target.id), { method: 'PUT', headers: { cookie: cookies.customer } })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
    assert.equal(await db.notification.count({ where: { relatedEntityId: target.id } }), 1);
  });
  await t.test('H11 and H12 share the same lock when manager and customer cancel concurrently', async () => {
    const target = await reserve({ date: nextDate, startTime: '20:00', endTime: '21:30' });
    const responses = await Promise.all([
      fetch(base + cancel(target.id), { method: 'PUT', headers: { cookie: cookies.customer } }),
      fetch(base + `/reservations/${target.id}/cancel`, { method: 'PUT', headers: { cookie: cookies.manager } }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: target.id } })).status, 'CANCELLED');
    assert.equal(await db.notification.count({ where: { relatedEntityId: target.id } }), 1);
  });
  await t.test('H10 create, H12 list and cancel, H11 occupancy and H10 availability remain consistent', async () => {
    const body = { branchId: otherBranch, date: nextDate, time: '16:00', partySize: 2 };
    const created = await request('customer', 'POST', '/reservations', body, 201);
    assert.ok((await request('customer', 'GET', list)).some(r => r.id === created.id && r.status === 'CONFIRMED'));
    const occupancy = `/management/branches/${otherBranch}/occupancy?date=${nextDate}`;
    const available = `/branches/${otherBranch}/reservation-availability?date=${nextDate}&partySize=2`;
    assert.equal((await request('general', 'GET', occupancy)).slots.find(s => s.startTime === '16:00').occupancyPercentage, 100);
    assert.equal((await request('customer', 'GET', available)).slots.find(s => s.time === '16:00').available, false);
    await request('customer', 'PUT', cancel(created.id), {});
    assert.equal((await request('general', 'GET', occupancy)).slots.find(s => s.startTime === '16:00').occupancyPercentage, 0);
    assert.equal((await request('customer', 'GET', available)).slots.find(s => s.time === '16:00').available, true);
    assert.equal(await db.notification.count({ where: { relatedEntityId: created.id } }), 2);
    await request('otherCustomer', 'POST', '/reservations', body, 201);
  });
  await t.test('notification failure does not undo a committed customer cancellation', async () => {
    const target = await reserve({ date: nextDate, startTime: '14:00', endTime: '15:30' });
    let observedStatus;
    const service = new CustomerReservationsService(db, new ReservationCancellationService(db, { async createNotification() {
      observedStatus = (await db.reservation.findUniqueOrThrow({ where: { id: target.id } })).status;
      throw new Error('Simulated notification outage');
    } }));
    const result = await service.cancel(target.id, {}, { userId: users.customer.id, role: 'CUSTOMER', branchId: null });
    assert.equal(observedStatus, 'CANCELLED'); assert.equal(result.status, 'CANCELLED');
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: target.id } })).status, 'CANCELLED');
  });
});
