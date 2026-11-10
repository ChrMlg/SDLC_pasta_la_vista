const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { ReservationManagementService } = require('../dist/reservations/reservation-management.service');
const { ReservationCancellationService } = require('../dist/reservations/reservation-cancellation.service');
const { localParts, timeMinutes, formatMinutes } = require('../dist/common/local-time');
const { seedReservationTables } = require('../prisma/seed.cjs');

test('H11 #42: management occupancy and cancellation with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && connection.pathname.endsWith('_test'), 'Use local PostgreSQL ending in _test');
  const db = new PrismaClient();
  const port = Number(process.env.H11_TEST_PORT || 3324);
  const base = `http://127.0.0.1:${port}/api`;
  const branches = Array.from({ length: 5 }, () => randomUUID());
  const [centro, bambu, ramblas, empty, flow] = branches;
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
    if (startupError || server.exitCode !== null) throw new Error('H11 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'H11 API starts within 10 seconds');
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H11-${run}-${i}`, name: `Sucursal H11 ${i}` })) });
  await seedReservationTables(db, branches.slice(0, 3));
  const tables = await db.table.findMany({ where: { branchId: centro }, orderBy: { number: 'asc' } });
  const bambuTables = await db.table.findMany({ where: { branchId: bambu }, orderBy: { number: 'asc' } });
  const ramblasTable = await db.table.findFirstOrThrow({ where: { branchId: ramblas } });
  const flowTable = await db.table.create({ data: { branchId: flow, number: 1, capacity: 4, status: 'OCCUPIED' } });
  const password = randomBytes(24).toString('hex');
  const passwordHash = await hashPassword(password);
  async function request(role, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(base + route, { method, headers: {
      'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${response.status}, ${value.code || ''}`);
    if (expected >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return { value, response };
  }
  for (const [label, role, branchId] of [
    ['customer', 'CUSTOMER', null], ['otherCustomer', 'CUSTOMER', null], ['waiter', 'WAITER', centro], ['kitchen', 'KITCHEN', centro],
    ['manager', 'MANAGER', centro], ['otherManager', 'MANAGER', bambu], ['unassigned', 'MANAGER', null], ['general', 'GENERAL_MANAGER', null],
  ]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@h11.invalid`, passwordHash, role, branchId } });
    const { response } = await request(null, 'POST', '/auth/login', { email: users[label].email, password });
    cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  async function reserve(table, changes = {}) {
    return db.reservation.create({ data: { branchId: table.branchId, tableId: table.id, customerId: users.customer.id,
      date, startTime: '12:00', endTime: '13:30', partySize: 2, ...changes } });
  }
  const first = await reserve(tables[0]);
  await reserve(tables[0], { startTime: '13:30', endTime: '15:00' });
  await reserve(tables[1], { startTime: '13:00', endTime: '14:30' });
  const pending = await reserve(tables[2], { status: 'PENDING', updatedAt: new Date('2020-01-01T00:00:00Z') });
  await reserve(tables[3], { status: 'CANCELLED' });
  await reserve(tables[4], { date: nextDate });
  const other = await reserve(bambuTables[0]);
  await reserve(bambuTables[1]);
  await reserve(ramblasTable);
  const occupancy = (branchId = centro, selectedDate = date) => `/management/branches/${branchId}/occupancy?date=${selectedDate}`;
  const cancel = id => `/reservations/${id}/cancel`;

  await t.test('both endpoints require a verified session, not forged identity headers', async () => {
    await request(null, 'GET', occupancy(), undefined, 401);
    await request(null, 'PUT', cancel(first.id), {}, 401);
    await request(null, 'PUT', cancel(first.id), {}, 401, { 'x-role': 'GENERAL_MANAGER', 'x-user-id': users.general.id });
  });
  for (const role of ['customer', 'waiter', 'kitchen']) await t.test(`${role} cannot access management endpoints`, async () => {
    await request(role, 'GET', occupancy(), undefined, 403);
    await request(role, 'PUT', cancel(first.id), {}, 403);
  });
  await t.test('manager branch isolation returns 404 and leaves reservations untouched', async () => {
    for (const role of ['otherManager', 'unassigned']) {
      await request(role, 'GET', occupancy(), undefined, 404);
      await request(role, 'PUT', cancel(first.id), {}, 404);
    }
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    assert.equal(await db.notification.count({ where: { userId: { in: userIds } } }), 0);
  });
  await t.test('occupancy counts distinct tables, overlaps, pending states and only the requested day', async () => {
    const { value } = await request('manager', 'GET', occupancy());
    assert.equal(value.totalTables, 12); assert.equal(value.timeZone, 'America/El_Salvador');
    assert.equal(value.reservations.length, 5);
    assert.deepEqual(value.slots.slice(0, 4).map(s => [s.startTime, s.reservedTables, s.availableTables, s.occupancyPercentage]),
      [['12:00', 2, 10, 16.67], ['13:00', 3, 9, 25], ['14:00', 2, 10, 16.67], ['15:00', 0, 12, 0]]);
    assert.equal(value.slots.length, 10); assert.equal(value.slots.at(-1).endTime, '22:00');
    assert.ok(value.reservations.every(r => r.date === date && tables.some(table => table.id === r.tableId)));
    assert.ok(value.reservations.every(r => Object.keys(r).sort().join() === 'date,endTime,id,partySize,startTime,status,tableId,tableNumber'));
    assert.ok(value.reservations.some(r => r.status === 'CANCELLED')); // Se muestra, sin consumir ocupación.
  });
  await t.test('general manager can select branches with 12, 10 and 8 tables', async () => {
    for (const [branchId, total, reserved, percent] of [[centro, 12, 2, 16.67], [bambu, 10, 2, 20], [ramblas, 8, 1, 12.5]]) {
      const { value } = await request('general', 'GET', occupancy(branchId));
      assert.equal(value.totalTables, total); assert.equal(value.slots[0].reservedTables, reserved); assert.equal(value.slots[0].occupancyPercentage, percent);
    }
  });
  await t.test('empty branches and historical days return zero without division errors', async () => {
    const { value } = await request('general', 'GET', occupancy(empty));
    assert.equal(value.totalTables, 0); assert.deepEqual(value.reservations, []);
    assert.ok(value.slots.every(s => s.occupancyPercentage === 0 && s.availableTables === 0));
    const historical = (await request('manager', 'GET', occupancy(centro, '2020-01-01'))).value;
    assert.ok(historical.slots.every(s => s.occupancyPercentage === 0 && s.availableTables === 12));
  });
  await t.test('operational table status does not rewrite future projected occupancy', async () => {
    await db.table.update({ where: { id: tables[11].id }, data: { status: 'OUT_OF_SERVICE' } });
    const { value } = await request('manager', 'GET', occupancy());
    assert.equal(value.totalTables, 12); assert.equal(value.slots[1].occupancyPercentage, 25);
  });
  await t.test('branch hours bound the slots including a final partial hour', async () => {
    await db.branch.update({ where: { id: empty }, data: { openingTime: '12:30', closingTime: '14:00' } });
    const { value } = await request('general', 'GET', occupancy(empty));
    assert.deepEqual(value.slots.map(s => [s.startTime, s.endTime]), [['12:30', '13:30'], ['13:30', '14:00']]);
  });
  await t.test('invalid IDs, dates, extra fields and missing resources return uniform errors', async () => {
    for (const route of [occupancy('invalid'), occupancy(centro, '2031-02-29'), occupancy() + '&date=2030-01-01', occupancy() + '&customerId=other', `/management/branches/${centro}/occupancy`])
      await request('general', 'GET', route, undefined, 400);
    await request('general', 'GET', occupancy(randomUUID()), undefined, 404);
    await request('manager', 'PUT', cancel('invalid'), {}, 400);
    await request('manager', 'PUT', cancel(randomUUID()), {}, 404);
    for (const body of [{ customerId: users.otherCustomer.id }, { status: 'CANCELLED' }, [], { branchId: centro }])
      await request('manager', 'PUT', cancel(first.id), body, 400);
  });
  await t.test('cancelling PENDING updates state and timestamp and recalculates occupancy', async () => {
    const { value } = await request('manager', 'PUT', cancel(pending.id));
    assert.equal(value.status, 'CANCELLED'); assert.ok(new Date(value.updatedAt) > pending.updatedAt);
    const saved = await db.reservation.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(saved.status, 'CANCELLED');
    const report = (await request('manager', 'GET', occupancy())).value;
    assert.equal(report.slots[0].reservedTables, 1); assert.equal(report.slots[1].reservedTables, 2);
  });
  await t.test('cancellation notification is unique and only visible to the reservation customer', async () => {
    const notices = await db.notification.findMany({ where: { relatedEntityId: pending.id } });
    assert.equal(notices.length, 1); assert.equal(notices[0].userId, users.customer.id);
    assert.equal(notices[0].eventKey, `reservation.cancelled:${pending.id}`);
    const inbox = (await request('customer', 'GET', '/notifications?sourceModule=RESERVATIONS')).value;
    assert.ok(inbox.data.some(n => n.relatedEntityId === pending.id));
    const otherInbox = (await request('otherCustomer', 'GET', '/notifications?sourceModule=RESERVATIONS')).value;
    assert.equal(otherInbox.total, 0);
    const { value } = await request('manager', 'PUT', cancel(pending.id), {}, 400);
    assert.equal(value.code, 'RESERVATION_ALREADY_CANCELLED');
    assert.equal(await db.notification.count({ where: { relatedEntityId: pending.id } }), 1);
  });
  await t.test('general manager cancels a reservation in another branch', async () => {
    const { value } = await request('general', 'PUT', cancel(other.id), {});
    assert.equal(value.branchId, bambu); assert.equal(value.status, 'CANCELLED');
  });
  await t.test('expired deadlines leave state, timestamp and notifications unchanged', async () => {
    const today = localParts(new Date());
    const start = Math.min(timeMinutes(today.time) + 60, 22 * 60);
    const late = await reserve(tables[5], { date: today.date, startTime: formatMinutes(start), endTime: formatMinutes(start + 90) });
    const { value } = await request('manager', 'PUT', cancel(late.id), {}, 400);
    assert.equal(value.code, 'CANCELLATION_DEADLINE_PASSED');
    const saved = await db.reservation.findUniqueOrThrow({ where: { id: late.id } });
    assert.equal(saved.status, 'CONFIRMED'); assert.equal(saved.updatedAt.getTime(), late.updatedAt.getTime());
    assert.equal(await db.notification.count({ where: { relatedEntityId: late.id } }), 0);
  });
  await t.test('concurrent cancellations produce one success and one notification', async () => {
    const target = await reserve(tables[6]);
    const responses = await Promise.all(['manager', 'general', 'manager'].map(role => fetch(base + cancel(target.id), {
      method: 'PUT', headers: { cookie: cookies[role] },
    })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400, 400]);
    assert.equal(await db.notification.count({ where: { eventKey: `reservation.cancelled:${target.id}` } }), 1);
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: target.id } })).status, 'CANCELLED');
  });
  await t.test('H10 creation followed by H11 cancellation releases availability without changing table status', async () => {
    const body = { branchId: flow, date, time: '12:00', partySize: 2 };
    const created = (await request('customer', 'POST', '/reservations', body, 201)).value;
    const route = `/branches/${flow}/reservation-availability?date=${date}&partySize=2`;
    assert.equal((await request('customer', 'GET', route)).value.slots[0].available, false);
    await request('general', 'PUT', cancel(created.id), {});
    assert.equal((await request('customer', 'GET', route)).value.slots[0].available, true);
    assert.equal((await request('general', 'GET', occupancy(flow))).value.slots[0].occupancyPercentage, 0);
    assert.equal((await db.table.findUniqueOrThrow({ where: { id: flowTable.id } })).status, 'OCCUPIED');
    assert.equal(await db.notification.count({ where: { relatedEntityId: created.id } }), 2); // Confirmación y cancelación.
    await request('customer', 'POST', '/reservations', body, 201);
  });
  await t.test('notification failure happens after commit and does not restore the reservation', async () => {
    const target = await reserve(tables[7]);
    let observedStatus;
    const service = new ReservationManagementService(db, new ReservationCancellationService(db, { async createNotification() {
      observedStatus = (await db.reservation.findUniqueOrThrow({ where: { id: target.id } })).status;
      throw new Error('Simulated notification outage');
    } }));
    const result = await service.cancel(target.id, {}, { userId: users.manager.id, role: 'MANAGER', branchId: centro });
    assert.equal(observedStatus, 'CANCELLED'); assert.equal(result.status, 'CANCELLED');
    assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: target.id } })).status, 'CANCELLED');
  });
});
