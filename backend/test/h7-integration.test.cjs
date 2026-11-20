const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { KitchenActionsService } = require('../dist/kitchen/kitchen-actions.service');
const { NotificationsService } = require('../dist/notifications/notifications.service');

test('H7 #38: take and release kitchen tickets with PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1');
  const db = new PrismaClient(), port = Number(process.env.H7_TEST_PORT || 3331);
  const base = process.env.H7_API_URL || `http://127.0.0.1:${port}/api`, api = new URL(base);
  assert.ok(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname));
  const branches = [randomUUID(), randomUUID()], run = randomUUID(), users = {}, cookies = {}, userIds = [];
  const tables = [], dishes = [];
  let server, serverErrors = '';
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      const branchId = { in: branches }, orders = { branchId }, ticket = { order: orders };
      await db.notification.deleteMany({ where: { userId: { in: userIds } } });
      await db.kitchenTicketLog.deleteMany({ where: { ticket } });
      await db.kitchenTicket.deleteMany({ where: { order: orders } });
      await db.orderItem.deleteMany({ where: { order: orders } });
      await db.order.deleteMany({ where: orders });
      await db.bill.deleteMany({ where: { branchId } });
      await db.menuItem.deleteMany({ where: { branchId } });
      await db.table.deleteMany({ where: { branchId } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: branches } } });
    } finally { await db.$disconnect(); }
  });
  if (!process.env.H7_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { serverErrors = (serverErrors + data).slice(-12000); });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H7 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H7-${run}-${i}`, name: `Sucursal H7 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role, index] of [['customer','CUSTOMER',null],['waiter','WAITER',0],['kitchen','KITCHEN',0],['secondKitchen','KITCHEN',0],['otherKitchen','KITCHEN',1],['otherWaiter','WAITER',1],['unassigned','KITCHEN',null],['manager','MANAGER',0],['general','GENERAL_MANAGER',null]]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, role, branchId: index === null ? null : branches[index], email: `${label.toLowerCase()}.${run}@h7.invalid`, passwordHash } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[label].email, password }) });
    assert.equal(response.status, 200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  for (const branchId of branches) {
    tables.push(await db.table.create({ data: { branchId, number: 1, capacity: 4, status: 'OCCUPIED' } }));
    dishes.push(await db.menuItem.create({ data: { branchId, name: 'Pasta H7', normalizedName: 'pasta h7', category: 'MAIN_COURSE', price: '10', createdById: users.manager.id } }));
  }
  async function fixture({ index = 0, status = 'PENDING', orderStatus = status, ticket = true, ticketBranch, type = 'DINE_IN', billStatus, creator = 'waiter' } = {}) {
    const [{ number }] = await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
    const bill = billStatus ? await db.bill.create({ data: { branchId: branches[index], type: 'TAKEAWAY', clientId: users.customer.id, status: billStatus, subtotal: '10', tax: '1.30', total: '11.30' } }) : null;
    return db.order.create({ data: { orderNumber: number, branchId: branches[index], type, tableId: type === 'DINE_IN' ? tables[index].id : null,
      createdById: users[creator].id, clientId: users.customer.id, total: '10', status: orderStatus, billId: bill?.id,
      items: { create: [1, 2].map(() => ({ dishId: dishes[index].id, quantity: 1, unitPrice: '5', status: status === 'IN_PREPARATION' ? status : 'PENDING' })) },
      ...(ticket ? { kitchenTicket: { create: { branchId: ticketBranch || branches[index], status } } } : {}),
    }, include: { kitchenTicket: true, items: true } });
  }
  async function request(role, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    const value = await response.json();
    if (response.status === 500) console.error('H7 diagnóstico SQL:', serverErrors.match(/(?:code:|Code:)[^\n]*/g)?.slice(-3) || 'Sin código SQLSTATE');
    if (expected !== null) assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${value.code || ''}`);
    if (response.status >= 400) assert.deepEqual(Object.keys(value).sort(), ['code', 'field', 'message']);
    return { status: response.status, value };
  }
  const change = (row, action = 'take', role = 'kitchen', expected = 200, body, branch = branches[0], headers) => request(role, 'PATCH', `/branches/${branch}/kitchen/orders/${typeof row === 'string' ? row : row.id}/${action}`, body, expected, headers);
  const snapshot = id => db.order.findUniqueOrThrow({ where: { id }, include: { kitchenTicket: { include: { logs: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } }, items: { orderBy: { id: 'asc' } } } });
  const notices = id => db.notification.findMany({ where: { eventKey: `order.in_preparation:${id}` }, orderBy: { userId: 'asc' } });
  const session = role => ({ userId: users[role].id, role: users[role].role, branchId: users[role].branchId });
  const first = await fixture();
  await t.test('authentication is required on both endpoints and identity headers are ignored', async () => {
    for (const action of ['take', 'release']) await change(first, action, null, 401, undefined, branches[0], { 'x-role': 'KITCHEN', 'x-user-id': users.kitchen.id });
  });
  for (const role of ['customer', 'waiter', 'manager', 'general']) await t.test(`${role} cannot take or release`, async () => {
    for (const action of ['take', 'release']) await change(first, action, role, 403);
  });
  await t.test('branch scope applies to route, order and ticket; unassigned kitchen is rejected', async () => {
    const other = await fixture({ index: 1 }), mismatch = await fixture({ ticketBranch: branches[1] });
    for (const action of ['take', 'release']) {
      await change(first, action, 'otherKitchen', 403); await change(first, action, 'unassigned', 403);
      await change(first, action, 'kitchen', 403, undefined, branches[1]);
      await change(other, action, 'kitchen', 403); await change(mismatch, action, 'kitchen', 403);
    }
  });
  await t.test('missing orders or tickets return 404; malformed IDs and injected fields return 400', async () => {
    const noTicket = await fixture({ ticket: false }); const before = await snapshot(first.id);
    for (const action of ['take', 'release']) {
      await change(randomUUID(), action, 'kitchen', 404); await change(noTicket, action, 'kitchen', 404);
      await change('invalid', action, 'kitchen', 400); await change(first, action, 'kitchen', 400, {}, 'invalid');
      for (const body of [{ takenById: users.secondKitchen.id }, { status: 'READY' }, { branchId: branches[1] }, []]) await change(first, action, 'kitchen', 400, body);
    }
    assert.deepEqual(await snapshot(first.id), before);
  });
  await t.test('taking synchronizes order and ticket, records session actor and notifies only branch staff', async () => {
    const since = Date.now(), { value } = await change(first.id.toUpperCase(), 'take', 'kitchen', 200, {}, branches[0].toUpperCase());
    assert.deepEqual(Object.keys(value).sort(), ['orderId','orderStatus','takenAt','takenById','ticketStatus']);
    assert.equal(value.orderId, first.id); assert.equal(value.ticketStatus, 'IN_PREPARATION'); assert.equal(value.orderStatus, 'IN_PREPARATION'); assert.equal(value.takenById, users.kitchen.id); assert.ok(Date.parse(value.takenAt) >= since);
    const saved = await snapshot(first.id); assert.equal(saved.status, saved.kitchenTicket.status); assert.equal(saved.kitchenTicket.takenAt.toISOString(), value.takenAt);
    assert.ok(saved.items.every(item => item.status === 'IN_PREPARATION' && !item.isReady));
    assert.equal(saved.kitchenTicket.logs.length, 1); assert.equal(saved.kitchenTicket.logs[0].action, 'TAKE'); assert.equal(saved.kitchenTicket.logs[0].userId, users.kitchen.id);
    assert.deepEqual((await notices(first.id)).map(row => row.userId).sort(), [users.kitchen.id, users.secondKitchen.id, users.waiter.id].sort());
    const view = await request('kitchen', 'GET', `/branches/${branches[0]}/kitchen/orders?status=IN_PREPARATION`);
    assert.ok(view.value.items.some(row => row.orderId === first.id));
  });
  await t.test('only one of two simultaneous cooks takes a ticket', async () => {
    const row = await fixture();
    const results = await Promise.all(['kitchen','secondKitchen'].map(role => change(row, 'take', role, null)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(results.find(result => result.status === 409).value.code, 'TICKET_ALREADY_TAKEN');
    const saved = await snapshot(row.id); assert.equal(saved.kitchenTicket.logs.length, 1);
    assert.equal(saved.kitchenTicket.takenById, results.find(result => result.status === 200).value.takenById);
    assert.equal((await notices(row.id)).length, 3);
  });
  await t.test('non-pending or inconsistent states reject taking without overwriting data', async () => {
    for (const status of ['IN_PREPARATION','READY','CANCELLED']) {
      const row = await fixture({ status }), before = await snapshot(row.id);
      assert.equal((await change(row, 'take', 'kitchen', 409)).value.code, 'TICKET_ALREADY_TAKEN'); assert.deepEqual(await snapshot(row.id), before);
    }
    const row = await fixture({ orderStatus: 'CANCELLED' }); await change(row, 'take', 'kitchen', 409);
  });
  await t.test('release can be performed by another cook of the branch and clears ownership and time', async () => {
    const before = await notices(first.id), { value } = await change(first, 'release', 'secondKitchen');
    assert.deepEqual(value, { orderId: first.id, ticketStatus: 'PENDING', orderStatus: 'PENDING' });
    const saved = await snapshot(first.id); assert.equal(saved.status, 'PENDING'); assert.equal(saved.kitchenTicket.takenById, null); assert.equal(saved.kitchenTicket.takenAt, null);
    assert.ok(saved.items.every(item => item.status === 'PENDING'));
    const log = saved.kitchenTicket.logs.find(log => log.action === 'RELEASE'); assert.equal(log.userId, users.secondKitchen.id);
    assert.deepEqual(await notices(first.id), before);
    await change(first, 'take', 'secondKitchen'); assert.deepEqual(await notices(first.id), before);
    assert.equal((await snapshot(first.id)).kitchenTicket.logs.length, 3);
  });
  await t.test('two releases yield one success and one TICKET_NOT_IN_PREPARATION', async () => {
    const row = await fixture(); await change(row);
    const results = await Promise.all(['kitchen','secondKitchen'].map(role => change(row, 'release', role, null)));
    assert.deepEqual(results.map(result => result.status).sort(), [200,409]);
    assert.equal(results.find(result => result.status === 409).value.code, 'TICKET_NOT_IN_PREPARATION');
    assert.equal((await snapshot(row.id)).kitchenTicket.logs.filter(row => row.action === 'RELEASE').length, 1);
  });
  await t.test('release rejects ready items using either readiness flag or legacy status', async () => {
    for (const data of [{ isReady: true }, { status: 'READY', isReady: false }]) {
      const row = await fixture(); await change(row); await db.orderItem.update({ where: { id: row.items[0].id }, data });
      const before = await snapshot(row.id);
      assert.equal((await change(row, 'release', 'kitchen', 409)).value.code, 'TICKET_HAS_READY_ITEMS'); assert.deepEqual(await snapshot(row.id), before);
    }
  });
  await t.test('release rejects all non-preparation states and preserves cancelled items in valid transitions', async () => {
    for (const status of ['PENDING','READY','CANCELLED']) {
      const row = await fixture({ status }); assert.equal((await change(row, 'release', 'kitchen', 409)).value.code, 'TICKET_NOT_IN_PREPARATION');
    }
    const row = await fixture(); await db.orderItem.update({ where: { id: row.items[0].id }, data: { status: 'CANCELLED' } });
    await change(row); await change(row, 'release'); assert.equal((await db.orderItem.findUnique({ where: { id: row.items[0].id } })).status, 'CANCELLED');
  });
  await t.test('unpaid TAKEAWAY cannot be taken even through the legacy endpoint', async () => {
    for (const billStatus of [undefined,'OPEN','CANCELLED']) {
      const row = await fixture({ type: 'TAKEAWAY', billStatus });
      assert.equal((await change(row, 'take', 'kitchen', 409)).value.code, 'ORDER_NOT_PAID');
      await request('kitchen', 'PATCH', `/orders/${row.id}/status/IN_PREPARATION`, {}, 409);
    }
    const row = await fixture({ type: 'TAKEAWAY', billStatus: 'PAID', creator: 'customer' }); await change(row);
    assert.equal((await notices(row.id)).length, 3);
  });
  await t.test('legacy take delegates to H7, logs actor and cannot bypass duplicate protection', async () => {
    const row = await fixture();
    assert.deepEqual((await request('kitchen','PATCH',`/orders/${row.id}/status/IN_PREPARATION`,{})).value,{id:row.id,status:'IN_PREPARATION'});
    assert.equal((await snapshot(row.id)).kitchenTicket.takenById,users.kitchen.id);
    assert.equal((await change(row,'take','secondKitchen',409)).value.code,'TICKET_ALREADY_TAKEN');
  });
  await t.test('release and existing readiness transition share the order lock; only one wins', async () => {
    const row=await fixture(); await change(row);
    const results=await Promise.all([change(row,'release','secondKitchen',null),request('kitchen','PATCH',`/orders/${row.id}/status/READY`,{},null)]);
    assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);
    const saved=await snapshot(row.id); assert.equal(saved.status,saved.kitchenTicket.status);
    if(saved.status==='READY') assert.ok(saved.items.every(item=>item.isReady));
    else {assert.equal(saved.status,'PENDING');assert.ok(saved.items.every(item=>!item.isReady));}
  });
  await t.test('failed audit insertion rolls back status, ownership and item changes without sending notices', async () => {
    const row=await fixture(),before=await snapshot(row.id);let called=false;
    const failingDb={$transaction:cb=>db.$transaction(tx=>cb(new Proxy(tx,{get(target,key){
      if(key==='kitchenTicketLog')return new Proxy(target.kitchenTicketLog,{get(delegate,method){if(method==='create')return async args=>{await delegate.create(args);throw new Error('Simulated audit failure');};return Reflect.get(delegate,method);}});
      return Reflect.get(target,key);
    }})))};
    const service=new KitchenActionsService(failingDb,{kitchenStatusCommitted:async()=>{called=true;}});
    await assert.rejects(service.change(branches[0],row.id,'TAKE',{},session('kitchen')),/Simulated audit failure/);
    assert.deepEqual(await snapshot(row.id),before);assert.equal(called,false);assert.deepEqual(await notices(row.id),[]);
  });
  await t.test('notification failure happens after commit and does not undo a take', async () => {
    const row=await fixture();let observed=false;
    const service=new KitchenActionsService(db,{kitchenStatusCommitted:async()=>{const saved=await snapshot(row.id);assert.equal(saved.kitchenTicket.status,'IN_PREPARATION');assert.equal(saved.kitchenTicket.logs.length,1);observed=true;throw new Error('Simulated delivery failure');}});
    const result=await service.change(branches[0],row.id,'TAKE',{},session('kitchen'));assert.equal(result.ticketStatus,'IN_PREPARATION');assert.equal(observed,true);
    assert.equal((await snapshot(row.id)).status,'IN_PREPARATION');
  });
  await t.test('confirmed take notification remains valid if release precedes notification delivery', async () => {
    const row=await fixture(),notifier=new NotificationsService(db);
    const service=new KitchenActionsService(db,{kitchenStatusCommitted:async(id,status,logId)=>{
      await new KitchenActionsService(db,notifier).change(branches[0],row.id,'RELEASE',{},session('secondKitchen'));
      await notifier.kitchenStatusCommitted(id,status,logId);
    }});
    await service.change(branches[0],row.id,'TAKE',{},session('kitchen'));assert.equal((await snapshot(row.id)).status,'PENDING');assert.equal((await notices(row.id)).length,3);
  });
  await t.test('revoked sessions cannot take or release', async () => {
    assert.equal((await fetch(base+'/auth/logout',{method:'POST',headers:{cookie:cookies.kitchen}})).status,204);
    await change(first,'take','kitchen',401);await change(first,'release','kitchen',401);
  });
});
