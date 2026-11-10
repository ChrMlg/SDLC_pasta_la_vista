const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { ReservationsService } = require('../dist/reservations/reservations.service');
const { NotificationsService } = require('../dist/notifications/notifications.service');
const { localParts } = require('../dist/common/local-time');
const { seedReservationTables } = require('../prisma/seed.cjs');

test('H10 #41: reservation API with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use a local PostgreSQL database ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H10_TEST_PORT || 3323);
  const base = `http://127.0.0.1:${port}/api`;
  const branches = Array.from({ length: 8 }, () => randomUUID());
  const [branch, otherBranch, raceBranch, emptyBranch, disabledBranch, ...seedBranches] = branches;
  const users = {}, cookies = {}, userIds = [];
  const run = randomUUID();
  const password = randomBytes(24).toString('hex');
  const date = localParts(new Date(Date.now() + 7 * 86400000)).date;
  const nextDate = localParts(new Date(Date.now() + 8 * 86400000)).date;
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) {
      const stopped = once(server, 'exit');
      server.kill('SIGTERM');
      await stopped;
    }
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
  let startupError;
  server.on('error', error => { startupError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || server.exitCode !== null) throw new Error('H10 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'H10 API should be ready within 10 seconds');
  await db.branch.createMany({ data: branches.map((id, index) => ({ id, code: `H10-${run}-${index}`, name: `Sucursal H10 ${index}` })) });
  const small = await db.table.create({ data: { branchId: branch, number: 1, capacity: 2 } });
  const large = await db.table.create({ data: { branchId: branch, number: 2, capacity: 4 } });
  await db.table.createMany({ data: [
    { branchId: otherBranch, number: 1, capacity: 4 },
    { branchId: raceBranch, number: 1, capacity: 4 },
    { branchId: disabledBranch, number: 1, capacity: 4, status: 'OUT_OF_SERVICE' },
    { branchId: disabledBranch, number: 2, capacity: null },
  ] });
  async function request(role, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(base + route, {
      method, headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: expected ${expected}, received ${response.status}, code ${value.code || ''}`);
    if (expected >= 400) {
      assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
      assert.equal(typeof value.message, 'string');
    }
    return { value, response };
  }
  for (const [label, role] of [['customer', 'CUSTOMER'], ['otherCustomer', 'CUSTOMER'], ['waiter', 'WAITER'], ['kitchen', 'KITCHEN'], ['manager', 'MANAGER'], ['general', 'GENERAL_MANAGER']]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: {
      id, email: `${label.toLowerCase()}.${run}@h10.invalid`, passwordHash: await hashPassword(password), role,
      branchId: ['CUSTOMER', 'GENERAL_MANAGER'].includes(role) ? null : branch,
    } });
    const result = await request(null, 'POST', '/auth/login', { email: users[label].email, password });
    cookies[label] = result.response.headers.get('set-cookie').split(';')[0];
  }
  const body = (changes = {}) => ({ branchId: branch, date, time: '12:00', partySize: 2, ...changes });
  const availability = (branchId = branch, selectedDate = date, size = 2) => `/branches/${branchId}/reservation-availability?date=${selectedDate}&partySize=${size}`;
  let first;

  await t.test('POST and availability require a verified session', async () => {
    await request(null, 'POST', '/reservations', body(), 401);
    await request(null, 'GET', availability(), undefined, 401);
    await request(null, 'POST', '/reservations', body(), 401, { 'x-role': 'CUSTOMER', 'x-user-id': users.customer.id });
  });
  for (const role of ['waiter', 'kitchen', 'manager', 'general']) await t.test(`${role} cannot use customer reservation endpoints`, async () => {
    await request(role, 'POST', '/reservations', body(), 403);
    await request(role, 'GET', availability(), undefined, 403);
  });
  await t.test('availability exposes hourly choices without customer or table data', async () => {
    const { value } = await request('customer', 'GET', availability());
    assert.equal(value.timeZone, 'America/El_Salvador');
    assert.deepEqual(value.slots.map(slot => slot.time), ['12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']);
    assert.ok(value.slots.every(slot => slot.available && Object.keys(slot).sort().join() === 'available,endTime,time'));
  });
  await t.test('creates a confirmed 90-minute reservation on the smallest suitable table', async () => {
    first = (await request('customer', 'POST', '/reservations', body(), 201)).value;
    assert.equal(first.status, 'CONFIRMED'); assert.equal(first.customerId, users.customer.id);
    assert.equal(first.tableId, small.id); assert.equal(first.branchId, branch);
    assert.equal(first.date, date); assert.equal(first.startTime, '12:00'); assert.equal(first.endTime, '13:30');
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: first.id } })).customerId, users.customer.id);
    assert.equal((await db.table.findUniqueOrThrow({ where: { id: small.id } })).status, 'AVAILABLE');
  });
  await t.test('confirmation notification is persisted only for the reservation owner', async () => {
    const notices = await db.notification.findMany({ where: { relatedEntityId: first.id } });
    assert.equal(notices.length, 1); assert.equal(notices[0].userId, users.customer.id);
    assert.equal(notices[0].eventKey, `reservation.confirmed:${first.id}`);
    assert.equal(notices[0].title, 'Reservación confirmada');
    const inbox = (await request('customer', 'GET', '/notifications?sourceModule=RESERVATIONS')).value;
    assert.ok(inbox.data.some(notice => notice.relatedEntityId === first.id));
    const otherInbox = (await request('otherCustomer', 'GET', '/notifications?sourceModule=RESERVATIONS')).value;
    assert.equal(otherInbox.total, 0);
  });
  await t.test('another customer can use a different table at the same time', async () => {
    const { value } = await request('otherCustomer', 'POST', '/reservations', body(), 201);
    assert.equal(value.tableId, large.id); assert.equal(value.customerId, users.otherCustomer.id);
  });
  await t.test('a full branch rejects overlapping requests without creating rows or notices', async () => {
    const count = await db.reservation.count({ where: { branchId: branch } });
    const notices = await db.notification.count({ where: { userId: users.customer.id } });
    await request('customer', 'POST', '/reservations', body({ time: '13:00' }), 409);
    assert.equal(await db.reservation.count({ where: { branchId: branch } }), count);
    assert.equal(await db.notification.count({ where: { userId: users.customer.id } }), notices);
    const { value } = await request('customer', 'GET', availability());
    assert.equal(value.slots[0].available, false); assert.equal(value.slots[1].available, false);
    assert.equal(value.slots[2].available, true);
  });
  await t.test('a later nonoverlapping slot is accepted', async () => {
    const { value } = await request('customer', 'POST', '/reservations', body({ time: '14:00' }), 201);
    assert.equal(value.tableId, small.id); assert.equal(value.endTime, '15:30');
  });
  await t.test('date and branch boundaries have independent availability', async () => {
    await request('customer', 'POST', '/reservations', body({ date: nextDate }), 201);
    const { value } = await request('customer', 'POST', '/reservations', body({ branchId: otherBranch }), 201);
    assert.equal(value.branchId, otherBranch);
  });
  await t.test('invalid body fields and types return uniform 400 errors', async () => {
    for (const changes of [
      { branchId: 'invalid' }, { date: '2031-02-29' }, { date: '2000-01-01' }, { time: '12:61' },
      { time: '11:00' }, { time: '12:30' }, { time: '21:00' }, { time: '22:00' },
      { partySize: 0 }, { partySize: -1 }, { partySize: 1.5 }, { partySize: '2' }, { partySize: 5 },
      { customerId: users.otherCustomer.id }, { tableId: large.id }, { status: 'PENDING' },
    ]) await request('customer', 'POST', '/reservations', body(changes), 400);
    await request('customer', 'POST', '/reservations', {}, 400);
    await request('customer', 'POST', '/reservations', [], 400);
  });
  await t.test('unknown branches return 404 and empty branches return 409', async () => {
    const absent = randomUUID();
    await request('customer', 'POST', '/reservations', body({ branchId: absent }), 404);
    await request('customer', 'GET', availability(absent), undefined, 404);
    await request('customer', 'POST', '/reservations', body({ branchId: emptyBranch }), 409);
    const { value } = await request('customer', 'GET', availability(emptyBranch));
    assert.ok(value.slots.every(slot => !slot.available));
  });
  await t.test('out-of-service tables and unset capacities cannot be assigned', async () => {
    await request('customer', 'POST', '/reservations', body({ branchId: disabledBranch }), 409);
    const { value } = await request('customer', 'GET', availability(disabledBranch));
    assert.ok(value.slots.every(slot => !slot.available));
  });
  await t.test('availability validates its date, quantity, branch ID and filters', async () => {
    for (const route of [availability('invalid'), availability(branch, '2000-01-01'), availability(branch, '2031-02-29'), availability(branch, date, 0), availability(branch, date, '1.5'), availability(branch, date, 5), availability() + '&customerId=' + users.customer.id])
      await request('customer', 'GET', route, undefined, 400);
  });
  await t.test('two customers racing for the last table receive exactly one 201 and one 409', async () => {
    const responses = await Promise.all(['customer', 'otherCustomer'].map(role => fetch(base + '/reservations', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies[role] },
      body: JSON.stringify(body({ branchId: raceBranch })),
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const payloads = await Promise.all(responses.map(response => response.json()));
    const winner = payloads.find(value => value.id);
    assert.equal(winner.status, 'CONFIRMED');
    assert.equal(await db.reservation.count({ where: { branchId: raceBranch } }), 1);
    assert.equal(await db.notification.count({ where: { relatedEntityId: winner.id } }), 1);
    const failure = payloads.find(value => value.code);
    assert.equal(failure.code, 'NO_TABLE_AVAILABLE');
  });
  await t.test('PENDING reservations block capacity and CANCELLED reservations release it', async () => {
    await db.reservation.updateMany({ where: { branchId: raceBranch }, data: { status: 'PENDING' } });
    await request('customer', 'POST', '/reservations', body({ branchId: raceBranch }), 409);
    await db.reservation.updateMany({ where: { branchId: raceBranch }, data: { status: 'CANCELLED' } });
    await request('customer', 'POST', '/reservations', body({ branchId: raceBranch }), 201);
  });
  await t.test('per-branch opening hours are respected', async () => {
    await db.branch.update({ where: { id: otherBranch }, data: { openingTime: '13:00', closingTime: '17:00' } });
    const { value } = await request('customer', 'GET', availability(otherBranch, nextDate));
    assert.deepEqual(value.slots.map(slot => slot.time), ['13:00', '14:00', '15:00']);
    await request('customer', 'POST', '/reservations', body({ branchId: otherBranch, date: nextDate, time: '12:00' }), 400);
    await request('customer', 'POST', '/reservations', body({ branchId: otherBranch, date: nextDate, time: '15:00' }), 201);
  });
  await t.test('notification failure does not roll back a committed reservation', async () => {
    let notified = false;
    const service = new ReservationsService(db, { async createNotification(notice) {
      const saved = await db.reservation.findUnique({ where: { id: notice.relatedEntityId } });
      assert.equal(saved.status, 'CONFIRMED'); notified = true;
      throw new Error('Simulated notification outage');
    } });
    const saved = await service.create(body({ time: '18:00' }), { userId: users.customer.id, role: 'CUSTOMER', branchId: null });
    assert.ok(notified); assert.ok(await db.reservation.findUnique({ where: { id: saved.id } }));
  });
  await t.test('duplicate confirmation events remain unique and wrong recipients are rejected', async () => {
    const notices = new NotificationsService(db, { async findCommittedOwner(event) {
      const saved = await db.reservation.findFirst({ where: { id: event.reservationId, status: event.status } });
      return saved?.customerId ?? null;
    } });
    const notice = { recipientId: users.customer.id, sourceModule: 'RESERVATIONS', eventKey: `reservation.confirmed:${first.id}`, relatedEntityId: first.id, title: 'Reservación confirmada', message: 'Confirmación de prueba' };
    await notices.createNotification(notice);
    assert.equal(await db.notification.count({ where: { relatedEntityId: first.id } }), 1);
    await assert.rejects(notices.createNotification({ ...notice, recipientId: users.otherCustomer.id }), error => error.status === 403);
  });
  await t.test('initial table seed is repeatable and preserves existing capacities and statuses', async () => {
    await db.table.create({ data: { branchId: seedBranches[0], number: 1, capacity: 7, status: 'OCCUPIED' } });
    await db.table.create({ data: { branchId: seedBranches[0], number: 2, capacity: null } });
    await seedReservationTables(db, seedBranches);
    await seedReservationTables(db, seedBranches);
    assert.deepEqual(await Promise.all(seedBranches.map(branchId => db.table.count({ where: { branchId } }))), [12, 10, 8]);
    const existing = await db.table.findUniqueOrThrow({ where: { branchId_number: { branchId: seedBranches[0], number: 1 } } });
    assert.equal(existing.capacity, 7); assert.equal(existing.status, 'OCCUPIED');
    assert.equal((await db.table.findUniqueOrThrow({ where: { branchId_number: { branchId: seedBranches[0], number: 2 } } })).capacity, 8);
    assert.equal(await db.table.count({ where: { branchId: branch } }), 2);
  });
  await t.test('database constraints reject invalid capacity, quantity, hours and duration', async () => {
    await assert.rejects(db.table.update({ where: { id: small.id }, data: { capacity: 0 } }));
    await assert.rejects(db.reservation.update({ where: { id: first.id }, data: { partySize: 0 } }));
    await assert.rejects(db.reservation.update({ where: { id: first.id }, data: { endTime: '13:00' } }));
    await assert.rejects(db.reservation.update({ where: { id: first.id }, data: { date: '2031-02-29' } }));
    await assert.rejects(db.branch.update({ where: { id: branch }, data: { openingTime: '22:00', closingTime: '12:00' } }));
  });
  await t.test('H12 customer listing and cancellation routes are not introduced', async () => {
    await request('customer', 'GET', '/me/reservations', undefined, 404);
    await request('customer', 'PUT', `/me/reservations/${first.id}/cancel`, {}, 404);
  });
});
