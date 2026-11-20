const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient, Prisma } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { allocatePaidAmounts, allocatePoints, accumulateLoyaltyPoints } = require('../dist/loyalty/loyalty.service');

const decimal = value => new Prisma.Decimal(value);

test('H19 monetary allocation uses Decimal-compatible cent arithmetic and floors each order', () => {
  const orders = [
    { id: 'first', total: decimal('3.33') },
    { id: 'second', total: decimal('3.33') },
    { id: 'last', total: decimal('3.34') },
  ];
  const amounts = allocatePaidAmounts(decimal('10.00'), orders);
  assert.deepEqual(amounts.map(value => value.amount.toFixed(2)), ['3.33', '3.33', '3.34']);
  assert.equal(amounts.reduce((sum, value) => sum.plus(value.amount), decimal(0)).toFixed(2), '10.00');
  assert.deepEqual(allocatePoints(decimal('10.00'), decimal('1.0000'), orders), [
    { orderId: 'first', points: 3 }, { orderId: 'second', points: 3 }, { orderId: 'last', points: 3 },
  ]);
  assert.deepEqual(allocatePoints(decimal('9.99'), decimal('1.0000'), [{ id: 'single', total: decimal('9.99') }]), [
    { orderId: 'single', points: 9 },
  ]);
  assert.deepEqual(allocatePoints(decimal('0.01'), decimal('0.0001'), [{ id: 'dust', total: decimal('0.01') }]), [
    { orderId: 'dust', points: 0 },
  ]);
  assert.deepEqual(allocatePaidAmounts(decimal('10.00'), []), []);
});

test('H19 points are earned only for paid customer orders, once and inside the payment transaction', { timeout: 90000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1', 'Run through backend/scripts/run-qa.cjs against local PostgreSQL');
  const db = new PrismaClient();
  const port = Number(process.env.H19_TEST_PORT || 3339);
  const base = `http://127.0.0.1:${port}/api`;
  const branchId = randomUUID(), customerId = randomUUID(), anonymousCustomerId = randomUUID(), waiterId = randomUUID();
  const run = randomUUID(), password = randomBytes(24).toString('hex');
  let server, originalRule;

  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      await db.loyaltyTransaction.deleteMany({ where: { account: { customerId: { in: [customerId, anonymousCustomerId] } } } });
      await db.loyaltyAccount.deleteMany({ where: { customerId: { in: [customerId, anonymousCustomerId] } } });
      await db.notification.deleteMany({ where: { userId: { in: [customerId, anonymousCustomerId, waiterId] } } });
      await db.kitchenTicket.deleteMany({ where: { branchId } });
      await db.order.deleteMany({ where: { branchId } });
      await db.receipt.deleteMany({ where: { branchId } });
      await db.payment.deleteMany({ where: { bill: { branchId } } });
      await db.bill.deleteMany({ where: { branchId } });
      await db.receiptCounter.deleteMany({ where: { branchId } });
      await db.authSession.deleteMany({ where: { userId: { in: [customerId, anonymousCustomerId, waiterId] } } });
      await db.user.deleteMany({ where: { id: { in: [customerId, anonymousCustomerId, waiterId] } } });
      await db.branch.deleteMany({ where: { id: branchId } });
      if (originalRule) await db.loyaltyRule.upsert({ where: { id: 'GLOBAL' }, create: originalRule,
        update: { conversionRate: originalRule.conversionRate, updatedById: originalRule.updatedById, updatedAt: originalRule.updatedAt } });
      else await db.loyaltyRule.deleteMany({ where: { id: 'GLOBAL' } });
    } finally { await db.$disconnect(); }
  });

  originalRule = await db.loyaltyRule.findUnique({ where: { id: 'GLOBAL' } });
  if (!originalRule) originalRule = await db.loyaltyRule.create({ data: { id: 'GLOBAL', conversionRate: '1.0000', updatedById: 'SYSTEM' } });
  await db.loyaltyRule.update({ where: { id: 'GLOBAL' }, data: { conversionRate: '1.0000' } });
  await db.branch.create({ data: { id: branchId, code: `H19-${run}`, name: 'H19 integration' } });
  const passwordHash = await hashPassword(password);
  await db.user.createMany({ data: [
    { id: customerId, role: 'CUSTOMER', email: `customer.${run}@h19.invalid`, passwordHash },
    { id: anonymousCustomerId, role: 'CUSTOMER', email: `anonymous.${run}@h19.invalid`, passwordHash },
    { id: waiterId, role: 'WAITER', branchId, email: `waiter.${run}@h19.invalid`, passwordHash },
  ] });
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) break;
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'H19 test API did not start');

  async function login(email) {
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  }
  const customer = await login(`customer.${run}@h19.invalid`);
  const waiter = await login(`waiter.${run}@h19.invalid`);
  const card = number => ({ cardHolder: 'Cliente H19', cardNumber: number, expMonth: 12, expYear: new Date().getUTCFullYear() + 2, cvv: '123' });

  async function fixture(clientId, amounts, total, statuses = [], discount = '0.00') {
    const subtotal = amounts.reduce((sum, value) => sum.plus(value), decimal(0));
    const tax = decimal(total).plus(discount).minus(subtotal);
    const bill = await db.bill.create({ data: { branchId, clientId, type: 'TAKEAWAY', subtotal, discount, tax, total } });
    const orders = [];
    for (const [index, amount] of amounts.entries()) {
      const [{ number }] = await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
      orders.push(await db.order.create({ data: { orderNumber: number, branchId, createdById: customerId, clientId, billId: bill.id,
        type: 'TAKEAWAY', status: statuses[index] || 'DELIVERED', total: amount } }));
    }
    return { bill, orders };
  }

  async function pay(billId, cookie, cardNumber, key = randomUUID()) {
    const response = await fetch(`${base}/bills/${billId}/payments`, { method: 'POST', headers: {
      'content-type': 'application/json', ...(cookie ? { cookie } : {}), 'idempotency-key': key,
    }, body: JSON.stringify(card(cardNumber)) });
    return { status: response.status, body: await response.json(), key };
  }

  async function createPaidPayment(fixtureRow, userId, amount) {
    await db.bill.update({ where: { id: fixtureRow.bill.id }, data: { status: 'PAID' } });
    return db.payment.create({ data: { billId: fixtureRow.bill.id, userId, idempotencyKey: randomUUID(), amount,
      cardLast4: '4242', status: 'PAID', completedAt: new Date() } });
  }

  await t.test('PAID payment, 9.99 rounding, replay, and rate changes keep prior transactions unchanged', async () => {
    const row = await fixture(customerId, ['9.99'], '9.99');
    const result = await pay(row.bill.id, customer, '4242424242424242');
    assert.equal(result.status, 200); assert.equal(result.body.status, 'PAID');
    const account = await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId }, include: { transactions: true } });
    assert.equal(account.balance, 9);
    assert.equal(account.transactions.length, 1);
    assert.equal(account.transactions[0].points, 9);
    assert.equal(account.transactions[0].orderId, row.orders[0].id);
    await pay(row.bill.id, customer, '4242424242424242', result.key);
    await db.loyaltyRule.update({ where: { id: 'GLOBAL' }, data: { conversionRate: '7.0000' } });
    assert.equal((await db.loyaltyTransaction.findUnique({ where: { paymentId_orderId: { paymentId: result.body.paymentId, orderId: row.orders[0].id } } })).points, 9);
    await db.loyaltyRule.update({ where: { id: 'GLOBAL' }, data: { conversionRate: '1.0000' } });
  });

  await t.test('database checks reject zero EARN points, malformed transaction shapes, and negative balances', async () => {
    const account = await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
    const existing = await db.loyaltyTransaction.findFirstOrThrow({ where: { accountId: account.id, type: 'EARN' } });
    await assert.rejects(db.loyaltyTransaction.create({ data: {
      accountId: account.id, type: 'EARN', points: 0, paymentId: existing.paymentId, orderId: existing.orderId,
    } }));
    await assert.rejects(db.loyaltyTransaction.create({ data: {
      accountId: account.id, type: 'REDEEM', points: 1, redemptionId: randomUUID(),
    } }));
    await assert.rejects(db.loyaltyAccount.update({ where: { id: account.id }, data: { balance: -1 } }));
  });

  await t.test('three orders receive rounded monetary shares then per-order floor; cancelled orders are excluded', async () => {
    const row = await fixture(customerId, ['3.33', '3.33', '3.34', '8.00'], '18.00', ['DELIVERED', 'DELIVERED', 'DELIVERED', 'CANCELLED']);
    const result = await pay(row.bill.id, customer, '4242424242424242');
    assert.equal(result.body.status, 'PAID');
    const txs = await db.loyaltyTransaction.findMany({ where: { paymentId: result.body.paymentId }, orderBy: { orderId: 'asc' } });
    assert.equal(txs.length, 3);
    const pointsByOrder = new Map(txs.map(tx => [tx.orderId, tx.points]));
    assert.deepEqual(row.orders.slice(0, 3).map(order => pointsByOrder.get(order.id)), [5, 5, 6]);
    assert.equal(txs.some(tx => tx.orderId === row.orders[3].id), false);
    assert.equal(txs.reduce((sum, tx) => sum + tx.points, 0), 16);
  });

  await t.test('a discounted bill accrues points from the amount actually paid', async () => {
    const row = await fixture(customerId, ['6.00', '4.00'], '8.00', [], '2.00');
    const result = await pay(row.bill.id, customer, '4242424242424242');
    assert.equal(result.body.status, 'PAID');
    const txs = await db.loyaltyTransaction.findMany({ where: { paymentId: result.body.paymentId } });
    const pointsByOrder = new Map(txs.map(tx => [tx.orderId, tx.points]));
    assert.deepEqual(row.orders.map(order => pointsByOrder.get(order.id)), [4, 3]);
    assert.equal(txs.reduce((sum, tx) => sum + tx.points, 0), 7);
  });

  await t.test('FAILED payment and bill without customer create no account or earn rows', async () => {
    const before = await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId } });
    const failedRow = await fixture(customerId, ['12.00'], '12.00');
    const failed = await pay(failedRow.bill.id, customer, '4000000000000002');
    assert.equal(failed.body.status, 'FAILED');
    assert.equal(await db.loyaltyTransaction.count({ where: { paymentId: failed.body.paymentId } }), 0);
    assert.equal((await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId } })).balance, before.balance);

    const anonymousRow = await fixture(null, ['12.00'], '12.00');
    const anonymousPaid = await pay(anonymousRow.bill.id, waiter, '4242424242424242');
    assert.equal(anonymousPaid.body.status, 'PAID');
    assert.equal(await db.loyaltyAccount.count({ where: { customerId: anonymousCustomerId } }), 0);
    assert.equal(await db.loyaltyTransaction.count({ where: { paymentId: anonymousPaid.body.paymentId } }), 0);
  });

  await t.test('zero points, missing rule, and concurrent replay are safe', async () => {
    await db.loyaltyRule.update({ where: { id: 'GLOBAL' }, data: { conversionRate: '0.0001' } });
    const zeroRow = await fixture(anonymousCustomerId, ['0.01'], '0.01');
    const zeroPayment = await createPaidPayment(zeroRow, anonymousCustomerId, '0.01');
    await db.$transaction(tx => accumulateLoyaltyPoints(tx, { paymentId: zeroPayment.id }));
    assert.equal(await db.loyaltyTransaction.count({ where: { paymentId: zeroPayment.id } }), 0);
    assert.equal(await db.loyaltyAccount.count({ where: { customerId: anonymousCustomerId } }), 0);

    await db.loyaltyRule.update({ where: { id: 'GLOBAL' }, data: { conversionRate: '1.0000' } });
    const duplicateRow = await fixture(anonymousCustomerId, ['10.00'], '10.00');
    const duplicatePayment = await createPaidPayment(duplicateRow, anonymousCustomerId, '10.00');
    await Promise.all([
      db.$transaction(tx => accumulateLoyaltyPoints(tx, { paymentId: duplicatePayment.id })),
      db.$transaction(tx => accumulateLoyaltyPoints(tx, { paymentId: duplicatePayment.id })),
    ]);
    let account = await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId: anonymousCustomerId }, include: { transactions: true } });
    assert.equal(account.balance, 10);
    assert.equal(account.transactions.filter(tx => tx.paymentId === duplicatePayment.id).length, 1);

    await db.loyaltyRule.delete({ where: { id: 'GLOBAL' } });
    const missingRuleRow = await fixture(customerId, ['4.00'], '4.00');
    const missingRulePayment = await pay(missingRuleRow.bill.id, customer, '4242424242424242');
    assert.equal(missingRulePayment.status, 200);
    assert.equal(missingRulePayment.body.status, 'PAID');
    assert.equal(await db.loyaltyTransaction.count({ where: { paymentId: missingRulePayment.body.paymentId } }), 0);
    await db.loyaltyRule.create({ data: { id: 'GLOBAL', conversionRate: '1.0000', updatedById: 'SYSTEM' } });
  });

  await t.test('an exception after accumulation rolls back both earn rows and balance; no HTTP accumulation route exists', async () => {
    const row = await fixture(anonymousCustomerId, ['2.00'], '2.00');
    const payment = await createPaidPayment(row, anonymousCustomerId, '2.00');
    const before = await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId: anonymousCustomerId } });
    await assert.rejects(db.$transaction(async tx => {
      await accumulateLoyaltyPoints(tx, { paymentId: payment.id });
      throw new Error('rollback H19 fixture');
    }), /rollback H19 fixture/);
    assert.equal((await db.loyaltyAccount.findUniqueOrThrow({ where: { customerId: anonymousCustomerId } })).balance, before.balance);
    assert.equal(await db.loyaltyTransaction.count({ where: { paymentId: payment.id } }), 0);
    const response = await fetch(`${base}/loyalty/accumulate`, { method: 'POST', headers: { cookie: customer, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 404);
  });
});
