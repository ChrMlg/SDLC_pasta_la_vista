const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');

test('H22: loyalty configuration API', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1', 'Use the local project connection through run-qa.cjs');
  const db = new PrismaClient();
  const port = Number(process.env.H22_TEST_PORT || 3332);
  const base = `http://127.0.0.1:${port}/api`;
  const users = {}, cookies = {}, userIds = [], benefitIds = [], run = randomUUID();
  const originalRule = await db.loyaltyRule.findUnique({ where: { id: 'GLOBAL' } });
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      await db.loyaltyBenefit.deleteMany({ where: { id: { in: benefitIds } } });
      if (originalRule) await db.loyaltyRule.upsert({ where: { id: 'GLOBAL' }, create: originalRule, update: { conversionRate: originalRule.conversionRate, updatedById: originalRule.updatedById, updatedAt: originalRule.updatedAt } });
      else await db.loyaltyRule.deleteMany({ where: { id: 'GLOBAL' } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally { await db.$disconnect(); }
  });

  if (!process.env.H22_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  }
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server && server.exitCode !== null) throw new Error('H22 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'H22 API did not become ready');

  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role] of [['general', 'GENERAL_MANAGER'], ['manager', 'MANAGER'], ['customer', 'CUSTOMER'], ['waiter', 'WAITER'], ['kitchen', 'KITCHEN']]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label}.${run}@h22.invalid`, passwordHash, role } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200);
    cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  if (!originalRule) await db.loyaltyRule.upsert({ where: { id: 'GLOBAL' }, create: { id: 'GLOBAL', conversionRate: '1.0000', updatedById: 'SYSTEM' }, update: {} });

  async function request(role, method, route, body, expected) {
    const response = await fetch(base + route, { method, headers: { ...(cookies[role] ? { cookie: cookies[role] } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${value?.code || ''}`);
    if (response.status >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return value;
  }
  async function benefit(body, method = 'POST', route = '/management/loyalty/benefits', role = 'general', expected = 201) {
    const value = await request(role, method, route, body, expected);
    if (expected === 201) benefitIds.push(value.id);
    return value;
  }

  await t.test('requires session and role; manager reads while only general manager writes', async () => {
    await request(null, 'GET', '/management/loyalty/rules', undefined, 401);
    await request(null, 'GET', '/management/loyalty/benefits', undefined, 401);
    for (const role of ['customer', 'waiter', 'kitchen']) {
      await request(role, 'GET', '/management/loyalty/rules', undefined, 403);
      await request(role, 'POST', '/management/loyalty/benefits', {}, 403);
    }
    assert.equal((await request('manager', 'GET', '/management/loyalty/rules', undefined, 200)).conversionRate > 0, true);
    await request('manager', 'PUT', '/management/loyalty/rules', { conversionRate: '2' }, 403);
    await request('manager', 'POST', '/management/loyalty/benefits', { name: 'No autorizado', pointsRequired: 1, discountValue: '1.00', isActive: true }, 403);
    await request('manager', 'PATCH', '/management/loyalty/benefits/' + randomUUID(), { isActive: false }, 403);
  });

  await t.test('singleton rule update is attributed to the authenticated manager and remains unique', async () => {
    const updated = await request('general', 'PUT', '/management/loyalty/rules', { conversionRate: '2.125' }, 200);
    assert.equal(updated.conversionRate, 2.125); assert.equal(updated.updatedById, users.general.id);
    await request('general', 'PUT', '/management/loyalty/rules', { conversionRate: '3' }, 200);
    assert.equal(await db.loyaltyRule.count(), 1);
    assert.equal((await db.loyaltyRule.findUniqueOrThrow({ where: { id: 'GLOBAL' } })).updatedById, users.general.id);
  });

  await t.test('rejects invalid rule rates and unexpected body fields', async () => {
    for (const value of ['0', '-1', '1.12345', '1000000', 'abc', 0, -1, 1.12345, 1000000]) await request('general', 'PUT', '/management/loyalty/rules', { conversionRate: value }, 400);
    await request('general', 'PUT', '/management/loyalty/rules', { conversionRate: '1', extra: true }, 400);
  });

  await t.test('creates benefits, validates values, and supports partial update/deactivation', async () => {
    for (const invalidBody of [
      { name: 'x', pointsRequired: 0, discountValue: '1.00', isActive: true },
      { name: 'x', pointsRequired: 1.5, discountValue: '1.00', isActive: true },
      { name: 'x', pointsRequired: -1, discountValue: '1.00', isActive: true },
      { name: 'x', pointsRequired: 2147483648, discountValue: '1.00', isActive: true },
      { name: 'x', pointsRequired: 1, discountValue: '0', isActive: true },
      { name: 'x', pointsRequired: 1, discountValue: '-1.00', isActive: true },
      { name: 'x', pointsRequired: 1, discountValue: '1.001', isActive: true },
      { name: 'x', pointsRequired: 1, discountValue: '100000000.00', isActive: true },
      { name: '', pointsRequired: 1, discountValue: '1.00', isActive: true },
      { name: '  ', pointsRequired: 1, discountValue: '1.00', isActive: true },
      { name: ' x', pointsRequired: 1, discountValue: '1.00', isActive: true },
      { name: 'x ', pointsRequired: 1, discountValue: '1.00', isActive: true },
      { name: 'x', pointsRequired: 1, discountValue: '1.00', isActive: 'true' },
    ]) await request('general', 'POST', '/management/loyalty/benefits', invalidBody, 400);
    const low = await benefit({ name: 'Beneficio bajo', pointsRequired: 10, discountValue: '2.50', isActive: true });
    const high = await benefit({ name: 'Beneficio alto', pointsRequired: 50, discountValue: '5.00', isActive: true });
    const inactive = await benefit({ name: 'Beneficio inactivo', pointsRequired: 1, discountValue: '1.00', isActive: false });
    assert.equal((await request('manager', 'GET', '/management/loyalty/benefits', undefined, 200)).length >= 3, true);
    const active = await request('customer', 'GET', '/loyalty/benefits', undefined, 200);
    assert.ok(active.findIndex(row => row.id === low.id) < active.findIndex(row => row.id === high.id));
    assert.equal(active.some(row => row.id === inactive.id), false);
    const disabled = await benefit({ isActive: false }, 'PATCH', `/management/loyalty/benefits/${low.id}`, 'general', 200);
    assert.equal(disabled.isActive, false);
    assert.equal((await request('customer', 'GET', '/loyalty/benefits', undefined, 200)).some(row => row.id === low.id), false);
    await request('general', 'PATCH', `/management/loyalty/benefits/${randomUUID()}`, { isActive: false }, 404);
    await request('general', 'PATCH', `/management/loyalty/benefits/${high.id}`, {}, 400);
    await request('customer', 'GET', '/management/loyalty/benefits', undefined, 403);
  });

  await t.test('database check constraints reject invalid config values', async () => {
    await assert.rejects(db.loyaltyBenefit.create({ data: { name: `bad-${run}`, pointsRequired: 0, discountValue: '1', isActive: true } }));
    await assert.rejects(db.loyaltyBenefit.create({ data: { name: `bad-${run}`, pointsRequired: 1, discountValue: '0', isActive: true } }));
    await assert.rejects(db.loyaltyRule.update({ where: { id: 'GLOBAL' }, data: { conversionRate: '0' } }));
  });
});
