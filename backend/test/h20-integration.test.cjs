const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { analyticsFixture } = require('./support/analytics-fixture.cjs');

test('H20: customer loyalty balance and history', { timeout: 60000 }, async t => {
  const { db, users, sale, request } = await analyticsFixture(t, 20);
  const balance = '/me/loyalty/balance', history = '/me/loyalty/history';
  const branchId = users.waiter.branchId;
  const customerId = users.customer.id;
  const empty = { balance: 0, reservedPoints: 0, availableBalance: 0 };
  const firstPage = { data: [], total: 0, page: 1, pageSize: 10 };
  for (const route of [balance, history]) {
    await request(route, 401, null);
    for (const role of ['manager', 'general', 'waiter', 'kitchen']) await request(route, 403, role);
  }
  assert.deepEqual(await request(balance, 200, 'customer'), empty);
  assert.deepEqual(await request(history, 200, 'customer'), firstPage);
  assert.equal(await db.loyaltyAccount.count({ where: { customerId } }), 0);
  for (const page of ['0', '-1', 'abc', '', '1.5']) {
    assert.equal((await request(history + '?page=' + page, 400, 'customer')).field, 'page');
  }

  const base = process.env.ANALYTICS_API_URL || 'http://127.0.0.1:3420/api';
  const password = randomUUID(), email = randomUUID() + '@h20.invalid';
  const register = await fetch(base + '/auth/register/customer', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, firstName: 'Cliente', lastName: 'Prueba', phone: '70000001' }) });
  assert.equal(register.status, 201);
  const otherId = (await register.json()).id;
  const benefitId = randomUUID(), confirmedId = randomUUID();
  const [{ present }] = await db.$queryRaw`SELECT to_regclass('"LoyaltyRedemption"') IS NOT NULL AS present`;
  const owners = { customerId: { in: [customerId, otherId] } };
  try {
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    async function other(route) {
      const response = await fetch(base + route, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } });
      assert.equal(response.status, 200);
      return response.json();
    }
    const a = await db.loyaltyAccount.create({ data: { customerId, balance: 230 } });
    const b = await db.loyaltyAccount.create({ data: { customerId: otherId, balance: 6 } });
    const { payment, orders, bill } = await sale({ count: 24 });
    const rows = orders.map((order, i) => ({ id: randomUUID(), accountId: a.id, type: 'EARN', points: 10,
      paymentId: payment.id, orderId: order.id, createdAt: new Date(Date.UTC(2026, 0, i % 3 + 1)) }));
    rows.push({ id: randomUUID(), accountId: a.id, type: 'REDEEM', points: -10, redemptionId: confirmedId, createdAt: new Date('2026-01-03') });
    const otherSale = await sale();
    const otherEntry = { id: randomUUID(), accountId: b.id, type: 'EARN', points: 6, paymentId: otherSale.payment.id, orderId: otherSale.orders[0].id };
    if (present) {
      await db.loyaltyBenefit.create({ data: { id: benefitId, name: 'Beneficio H20', pointsRequired: 10, discountValue: '1.00' } });
      for (const [id, account, status, points, owner] of [[confirmedId, a, 'CONFIRMED', 10, customerId],
        [randomUUID(), a, 'PENDING', 20, customerId], [randomUUID(), a, 'PENDING', 30, customerId],
        [randomUUID(), a, 'RELEASED', 12, customerId], [randomUUID(), b, 'PENDING', 3, otherId]]) {
        const target = status === 'CONFIRMED' ? bill : await db.bill.create({ data: { branchId, clientId: owner, type: 'TAKEAWAY', subtotal: 1, tax: 0, total: 1 } });
        await db.loyaltyRedemption.create({ data: { id, accountId: account.id, billId: target.id, benefitId, status, points, discountAmount: '1.00' } });
      }
    }
    if (present) rows.find(row => row.type === 'REDEEM').paymentId = payment.id;
    await db.loyaltyTransaction.createMany({ data: [...rows, otherEntry] });
    assert.deepEqual(await request(balance + '?customerId=' + otherId, 200, 'customer'),
      { balance: 230, reservedPoints: present ? 50 : 0, availableBalance: present ? 180 : 230 });
    assert.deepEqual(await other(balance + '?customerId=' + customerId),
      { balance: 6, reservedPoints: present ? 3 : 0, availableBalance: present ? 3 : 6 });
    assert.deepEqual((await other(history + '?customerId=' + customerId)).data.map(row => row.id), [otherEntry.id]);
    const all = [];
    for (const page of [1, 2, 3, 4]) {
      const result = await request(history + '?page=' + page + '&customerId=' + otherId, 200, 'customer');
      assert.equal(result.total, 25); assert.equal(result.page, page); assert.equal(result.pageSize, 10);
      assert.equal(result.data.length, [10, 10, 5, 0][page - 1]);
      all.push(...result.data);
    }
    const expected = rows.sort((x, y) => y.createdAt - x.createdAt || y.id.localeCompare(x.id));
    assert.deepEqual(all.map(row => row.id), expected.map(row => row.id));
    assert.equal(all.reduce((sum, row) => sum + row.points, 0), a.balance);
    for (const [i, row] of expected.entries()) {
      assert.deepEqual(all[i], { id: row.id, type: row.type, points: row.points, createdAt: row.createdAt.toISOString(),
        paymentId: row.paymentId ?? (present ? payment.id : null), orderId: row.orderId ?? null, redemptionId: row.redemptionId ?? null,
        ...(row.type === 'REDEEM' ? { benefitName: present ? 'Beneficio H20' : null } : {}) });
    }
  } finally {
    await db.loyaltyTransaction.deleteMany({ where: { account: owners } });
    if (present) await db.$executeRaw`DELETE FROM "LoyaltyRedemption" WHERE "benefitId" = ${benefitId}::uuid`;
    await db.loyaltyBenefit.deleteMany({ where: { id: benefitId } });
    await db.loyaltyAccount.deleteMany({ where: owners });
    await db.bill.deleteMany({ where: { branchId, clientId: otherId } });
    await db.user.delete({ where: { id: otherId } });
  }
});
