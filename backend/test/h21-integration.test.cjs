const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { analyticsFixture } = require('./support/analytics-fixture.cjs');

test('H21: loyalty redemption at checkout', { timeout: 90000 }, async t => {
  assert.equal(process.env.ALLOW_LOCAL_FIXTURES, '1');
  const { db, branches, users, cookies } = await analyticsFixture(t, 21);
  const base = process.env.ANALYTICS_API_URL || 'http://127.0.0.1:3421/api';
  const branchId = branches[0], customerId = users.customer.id, benefitId = randomUUID(), otherBenefit = randomUUID();
  const bill = (data = {}) => db.bill.create({ data: { branchId, clientId: customerId, type: 'TAKEAWAY', subtotal: 20, discount: 0, tax: '2.60', total: '22.60', ...data } });
  async function request(method, route, body, role = 'customer', headers = {}) {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const redeem = (billId, benefit = benefitId) => request('POST', '/loyalty/redeem', { billId, benefitId: benefit });
  const release = id => request('DELETE', '/loyalty/redeem/' + id);
  async function error(promise, status, code) {
    const result = await promise;
    assert.equal(result.status, status, JSON.stringify(result.body)); assert.equal(result.body.code, code);
    assert.deepEqual(Object.keys(result.body).sort(), ['code','field','message']);
    return result.body;
  }
  try {
    await db.loyaltyBenefit.createMany({ data: [benefitId, otherBenefit].map(id => ({ id, name: 'H21', pointsRequired: 50, discountValue: 5 })) });
    const first = await bill(), second = await bill();
    await t.test('session, validation, ownership and eligible benefits', async () => {
      for (const [method, route] of [['POST','/loyalty/redeem'], ['DELETE','/loyalty/redeem/' + randomUUID()]]) {
        await error(request(method, route, undefined, null), 401, 'UNAUTHORIZED');
        await error(request(method, route, undefined, 'waiter'), 403, 'FORBIDDEN');
      }
      for (const body of [{}, { billId: 'bad', benefitId }, { billId: first.id, benefitId, orderId: randomUUID() }])
        await error(request('POST','/loyalty/redeem',body), 400, 'VALIDATION_ERROR');
      for (const id of [randomUUID(), (await bill({ clientId: null })).id, (await bill({ clientId: users.manager.id })).id])
        await error(redeem(id), 404, 'BILL_NOT_FOUND');
      await error(redeem((await bill({ status: 'PAID' })).id), 409, 'BILL_NOT_OPEN');
      await error(redeem(first.id, randomUUID()), 404, 'BENEFIT_NOT_FOUND');
      await db.loyaltyBenefit.update({ where: { id: otherBenefit }, data: { isActive: false } });
      await error(redeem(first.id, otherBenefit), 404, 'BENEFIT_NOT_FOUND');
      await db.loyaltyBenefit.update({ where: { id: otherBenefit }, data: { isActive: true } });
      assert.equal((await error(redeem(first.id), 400, 'INSUFFICIENT_POINTS')).field,'benefitId');
    });
    const account = await db.loyaltyAccount.create({ data: { customerId, balance: 70 } });
    await t.test('one reservation across simultaneous bills and double clicks', async () => {
      const pair = await Promise.all([redeem(first.id), redeem(second.id)]);
      assert.deepEqual(pair.map(r => r.status).sort(), [201,400]);
      assert.equal(pair.find(r => r.status === 400).body.code, 'INSUFFICIENT_POINTS');
      const held = pair.find(r => r.status === 201).body;
      assert.equal(held.availableBalance, 20); assert.equal(held.points, 50); assert.equal(held.status, 'PENDING');
      assert.deepEqual(held.bill, { id: held.bill.id, subtotal: 20, discount: 5, tax: 1.95, total: 16.95 });
      assert.equal((await db.bill.findUniqueOrThrow({ where: { id: held.bill.id } })).redemptionId, held.redemptionId);
      assert.equal((await db.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } })).balance,70);
      const released = await release(held.redemptionId);
      assert.deepEqual(released.body, { status: 'RELEASED', bill: { id: held.bill.id, subtotal: 20, discount: 0, tax: 2.6, total: 22.6 } });
      assert.deepEqual(await release(held.redemptionId), released);
      const clicks = await Promise.all([redeem(first.id,otherBenefit),redeem(first.id,otherBenefit)]);
      assert.deepEqual(clicks.map(r => r.status).sort(), [201,409]);
      assert.equal(clicks.find(r => r.status === 409).body.code,'REDEMPTION_ALREADY_EXISTS');
      await release(clicks.find(r => r.status === 201).body.redemptionId);
      const small = await bill({ subtotal: 5, tax: 0.65, total: 5.65 });
      await error(redeem(small.id),422,'REDEMPTION_TOTAL_TOO_LOW');
      assert.equal(await db.loyaltyRedemption.count({ where: { billId: small.id } }),0);
    });
    await t.test('order attachment reprices and bill cancellation releases the reservation', async () => {
      const held = (await redeem(first.id)).body;
      const [{ number }] = await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
      await db.order.create({ data: { branchId, clientId: customerId, createdById: customerId, orderNumber: number, billId: first.id, type: 'TAKEAWAY', total: 10 } });
      const priced = await db.bill.findUniqueOrThrow({ where: { id: first.id } });
      assert.deepEqual([priced.subtotal, priced.discount, priced.tax, priced.total].map(Number), [30,5,3.25,28.25]);
      const cancelled = await db.bill.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
      assert.equal(cancelled.redemptionId,null); assert.equal(Number(cancelled.total),33.90);
      assert.equal((await release(held.redemptionId)).body.status,'RELEASED');
    });
    await t.test('payment failure retains snapshot; successful retry debits once', async () => {
      const held = (await redeem(second.id)).body;
      await db.loyaltyBenefit.update({ where: { id: benefitId }, data: { pointsRequired: 67, discountValue: 15, isActive: false } });
      const route = '/bills/' + second.id + '/payments';
      const pay = (number, key) => request('POST',route,{ cardHolder:'Cliente H21',cardNumber:number,expMonth:12,expYear:new Date().getUTCFullYear()+2,cvv:'123' },'customer',{'idempotency-key':key});
      assert.equal((await pay('4000000000000002',randomUUID())).body.status,'FAILED');
      assert.equal((await db.loyaltyRedemption.findUniqueOrThrow({ where:{id:held.redemptionId} })).status,'PENDING');
      assert.equal((await db.loyaltyAccount.findUniqueOrThrow({ where:{id:account.id} })).balance,70);
      const key = randomUUID(), paid = (await pay('4242424242424242',key)).body;
      assert.equal(paid.status,'PAID'); assert.equal((await pay('4242424242424242',key)).body.paymentId,paid.paymentId);
      const saved = await db.loyaltyRedemption.findUniqueOrThrow({ where:{id:held.redemptionId} });
      assert.equal(saved.status,'CONFIRMED'); assert.equal(saved.points,50); assert.equal(Number(saved.discountAmount),5);
      assert.equal(saved.paymentId,paid.paymentId);
      assert.equal(Number((await db.payment.findUniqueOrThrow({ where:{id:paid.paymentId} })).amount),16.95);
      assert.equal((await db.loyaltyAccount.findUniqueOrThrow({ where:{id:account.id} })).balance,20);
      assert.deepEqual(await db.loyaltyTransaction.findMany({ where:{redemptionId:saved.id},select:{type:true,points:true,paymentId:true} }),
        [{type:'REDEEM',points:-50,paymentId:paid.paymentId}]);
      await error(release(saved.id),409,'BILL_NOT_OPEN');
    });
  } finally {
    await db.loyaltyTransaction.deleteMany({ where:{account:{customerId}} });
    await db.bill.updateMany({ where:{branchId,redemptionId:{not:null}},data:{redemptionId:null} });
    await db.loyaltyRedemption.deleteMany({ where:{bill:{branchId}} });
    await db.loyaltyBenefit.deleteMany({ where:{id:{in:[benefitId,otherBenefit]}} });
    await db.loyaltyAccount.deleteMany({ where:{customerId} });
    await db.receipt.deleteMany({ where:{branchId} });
    await db.receiptCounter.deleteMany({ where:{branchId} });
  }
});
