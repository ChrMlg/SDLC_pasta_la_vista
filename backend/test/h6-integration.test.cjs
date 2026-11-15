const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');

test('H6 #37: branch kitchen queue with local PostgreSQL', { timeout: 60000 }, async t => {
  const connection = new URL(process.env.DATABASE_URL || 'http://missing');
  assert.ok(['postgres:', 'postgresql:'].includes(connection.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) && process.env.ALLOW_LOCAL_FIXTURES === '1', 'Use the local project connection through run-qa.cjs');
  const db = new PrismaClient(), port = Number(process.env.H6_TEST_PORT || 3330);
  const base = process.env.H6_API_URL || `http://127.0.0.1:${port}/api`, api = new URL(base);
  assert.ok(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname));
  const branches = [randomUUID(), randomUUID()], run = randomUUID(), userIds = [], users = {}, cookies = {};
  const tables = [], dishes = [];
  let server;
  t.after(async () => {
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    try {
      const orders = await db.order.findMany({ where: { branchId: { in: branches } }, select: { id: true } });
      const orderId = { in: orders.map(row => row.id) }, branchId = { in: branches };
      await db.notification.deleteMany({ where: { userId: { in: userIds } } });
      await db.kitchenTicket.deleteMany({ where: { orderId } });
      await db.orderLinkCode.deleteMany({ where: { orderId } });
      await db.orderItem.deleteMany({ where: { orderId } });
      await db.order.deleteMany({ where: { branchId } });
      await db.receipt.deleteMany({ where: { branchId } });
      await db.payment.deleteMany({ where: { bill: { branchId } } });
      await db.bill.deleteMany({ where: { branchId } });
      await db.receiptCounter.deleteMany({ where: { branchId } });
      await db.menuItem.deleteMany({ where: { branchId } });
      await db.table.deleteMany({ where: { branchId } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.branch.deleteMany({ where: { id: { in: branches } } });
    } finally { await db.$disconnect(); }
  });
  if (!process.env.H6_API_URL) {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore' });
  }
  let ready = false, startupError;
  if (server) server.on('error', error => { startupError = error; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (startupError || (server && server.exitCode !== null)) throw new Error('H6 API could not start');
    try { if ((await fetch(base + '/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await db.branch.createMany({ data: branches.map((id, i) => ({ id, code: `H6-${run}-${i}`, name: `Sucursal H6 ${i}` })) });
  const password = randomBytes(24).toString('hex'), passwordHash = await hashPassword(password);
  for (const [label, role, index] of [['customer','CUSTOMER',null],['waiter','WAITER',0],['kitchen','KITCHEN',0],['otherKitchen','KITCHEN',1],['unassigned','KITCHEN',null],['manager','MANAGER',0],['general','GENERAL_MANAGER',null]]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, role, branchId: index === null ? null : branches[index], email: `${label.toLowerCase()}.${run}@h6.invalid`, passwordHash } });
    const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify({ email:users[label].email, password }) });
    assert.equal(response.status,200); cookies[label] = response.headers.get('set-cookie').split(';')[0];
  }
  for (const branchId of branches) {
    tables.push(await db.table.create({ data: { branchId, number:1, status:'OCCUPIED', capacity:4 } }));
    dishes.push(await db.menuItem.create({ data: { branchId, name:'Pasta H6', normalizedName:'pasta h6', category:'MAIN_COURSE', price:'10', createdById:users.manager.id } }));
  }
  async function request(role, method, route, body, expected = 200, headers = {}) {
    const response = await fetch(base + route, { method, headers: { 'content-type':'application/json', ...(cookies[role] ? {cookie:cookies[role]} : {}), ...headers }, ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(15000) });
    const value = await response.json(); assert.equal(response.status,expected,`${method}: ${response.status} ${value.code || ''}`);
    if(expected >= 400) assert.deepEqual(Object.keys(value).sort(),['code','field','message']); return value;
  }
  const list = (query = '', role = 'kitchen', branch = branches[0], expected = 200, headers = {}) => request(role,'GET',`/branches/${branch}/kitchen/orders${query}`,undefined,expected,headers);
  async function fixture({ index=0, type='DINE_IN', status='PENDING', billStatus, ticket=true, ticketBranch, enteredAt=new Date(), orderCreatedAt=new Date(), itemStatus='PENDING', orderStatus=status } = {}) {
    const [{ number }] = await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
    const bill = billStatus ? await db.bill.create({ data:{ branchId:branches[index], type:'TAKEAWAY', clientId:users.customer.id, status:billStatus, subtotal:'10', tax:'1.30', total:'11.30', ...(billStatus === 'PAID' ? {paidAt:enteredAt} : {}) } }) : null;
    return db.order.create({ data:{ orderNumber:number,branchId:branches[index],type,tableId:type==='DINE_IN'?tables[index].id:null,createdById:users.waiter.id,clientId:users.customer.id,total:'10',status:orderStatus,createdAt:orderCreatedAt,billId:bill?.id,
      items:{create:{dishId:dishes[index].id,quantity:2,unitPrice:'5',note:'Sin cebolla',status:itemStatus}},
      ...(ticket?{kitchenTicket:{create:{branchId:ticketBranch || branches[index],status,createdAt:enteredAt}}}:{}),
    }, include:{kitchenTicket:true,items:true} });
  }
  await t.test('session required and identity headers cannot replace authentication',async()=>{
    await list('',null,branches[0],401);
    await list('',null,branches[0],401,{'x-role':'KITCHEN','x-branch-id':branches[0],'x-user-id':users.kitchen.id});
  });
  for(const role of ['customer','waiter','manager','general']) await t.test(`${role} cannot read kitchen orders`,async()=>{await list('',role,branches[0],403);});
  await t.test('kitchen cannot cross branches or use an unassigned account',async()=>{
    await list('','kitchen',branches[1],403);await list('','otherKitchen',branches[0],403);await list('','unassigned',branches[0],403);
    await list('','otherKitchen',branches[0],403,{'x-branch-id':branches[0]});
  });
  await t.test('malformed IDs and invalid or repeated query fields return 422',async()=>{
    await list('','kitchen','invalid',422);
    for(const query of ['?status=','?status=DELIVERED','?status=OUT_FOR_DELIVERY','?status=pending','?status=PENDING,','?status=PENDING,%20READY','?status=PENDING&status=READY','?status[x]=READY','?branchId='+branches[1]])await list(query,'kitchen',branches[0],422);
  });
  await t.test('empty branch returns items array and reads do not create tickets',async()=>{
    assert.deepEqual(await list(),{items:[]}); await fixture({ticket:false});assert.deepEqual(await list(),{items:[]});
  });
  let pending, preparing, readyTicket, cancelled;
  await t.test('default includes pending and in-preparation ordered by ticket arrival, not order creation',async()=>{
    pending=await fixture({enteredAt:new Date('2026-01-02T12:00:00Z'),orderCreatedAt:new Date('2025-01-01T00:00:00Z')});
    preparing=await fixture({status:'IN_PREPARATION',enteredAt:new Date('2026-01-01T12:00:00Z'),orderCreatedAt:new Date('2026-01-01T00:00:00Z')});
    readyTicket=await fixture({status:'READY',itemStatus:'READY'});cancelled=await fixture({status:'CANCELLED'});
    await fixture({index:1});
    assert.deepEqual((await list()).items.map(row=>row.orderId),[preparing.id,pending.id]);
  });
  await t.test('contract includes table, dish, quantities, notes and readiness without private account data',async()=>{
    const row=(await list()).items.find(row=>row.orderId===pending.id);
    assert.deepEqual(Object.keys(row).sort(),['enteredAt','items','orderId','orderNumber','status','tableLabel','type','updatedAt']);
    assert.equal(row.tableLabel,'Mesa 1');assert.equal(row.orderNumber,pending.orderNumber);assert.equal(row.enteredAt,pending.kitchenTicket.createdAt.toISOString());
    assert.deepEqual(row.items,[{id:pending.items[0].id,dishName:'Pasta H6',quantity:2,note:'Sin cebolla',isReady:false}]);
    assert.ok(!JSON.stringify(row).includes('@'));assert.ok(!JSON.stringify(row).includes('clientId'));assert.ok(!JSON.stringify(row).includes('password'));
  });
  await t.test('explicit filters include READY/CANCELLED, deduplicate states and preserve stable ties',async()=>{
    const results=(await list('?status=READY,CANCELLED,READY')).items;
    assert.equal(results.length,2);assert.deepEqual(new Set(results.map(row=>row.orderId)),new Set([readyTicket.id,cancelled.id]));
    assert.equal(results.find(row=>row.orderId===readyTicket.id).items[0].isReady,true);
    const one=await fixture({enteredAt:new Date('2020-01-01T12:00:00Z')}),two=await fixture({enteredAt:new Date('2020-01-01T12:00:00Z')});
    assert.deepEqual((await list('?status=PENDING')).items.slice(0,2).map(row=>row.orderId),[one.id,two.id].sort());
    assert.deepEqual(await list('?status=PENDING','kitchen',branches[0].toUpperCase()),await list('?status=PENDING'));
  });
  await t.test('TAKEAWAY without bill or with OPEN/CANCELLED bill is excluded even with a ticket',async()=>{
    const rows=[];for(const billStatus of [undefined,'OPEN','CANCELLED'])rows.push(await fixture({type:'TAKEAWAY',billStatus}));
    const result=await list();assert.ok(result.items.every(item=>!rows.some(row=>row.id===item.orderId)));
  });
  await t.test('paid TAKEAWAY is visible with its ticket time and Para llevar label',async()=>{
    const row=await fixture({type:'TAKEAWAY',billStatus:'PAID',enteredAt:new Date('2024-03-01T12:00:00Z')});
    const item=(await list()).items.find(item=>item.orderId===row.id);assert.equal(item.tableLabel,'Para llevar');assert.equal(item.enteredAt,row.kitchenTicket.createdAt.toISOString());
  });
  await t.test('both ticket branch and order branch are checked',async()=>{
    const row=await fixture({index:1,ticketBranch:branches[0]});
    assert.ok(!(await list()).items.some(item=>item.orderId===row.id));assert.ok(!(await list('','otherKitchen',branches[1])).items.some(item=>item.orderId===row.id));
  });
  await t.test('READY ticket remains visible when the order advances to delivery',async()=>{
    const row=await fixture({status:'READY',orderStatus:'DELIVERED',itemStatus:'READY'});
    assert.equal((await list('?status=READY')).items.find(item=>item.orderId===row.id).status,'READY');
    assert.ok(!(await list()).items.some(item=>item.orderId===row.id));
  });
  await t.test('real DINE_IN creation immediately creates one branch-scoped ticket',async()=>{
    const row=await request('waiter','POST','/orders',{branchId:branches[0],type:'DINE_IN',tableId:tables[0].id,items:[{dishId:dishes[0].id,quantity:1,note:'Sin sal'}]},201);
    const ticket=await db.kitchenTicket.findUniqueOrThrow({where:{orderId:row.id}});assert.equal(ticket.branchId,branches[0]);
    const listed=(await list()).items.find(item=>item.orderId===row.id);assert.equal(listed.status,'PENDING');assert.equal(listed.items[0].note,'Sin sal');
    await list();assert.equal(await db.kitchenTicket.count({where:{orderId:row.id}}),1);
  });
  await t.test('real TAKEAWAY waits for approved payment; retries do not duplicate or reorder tickets',async()=>{
    const row=await request('customer','POST','/orders/customer',{branchId:branches[0],type:'TAKEAWAY',items:[{dishId:dishes[0].id,quantity:1}]},201);
    const absent=async()=>assert.ok(!(await list()).items.some(item=>item.orderId===row.id));await absent();
    const bill=await request('customer','POST',`/branches/${branches[0]}/bills`,{orderId:row.id},201);
    const payment=cardNumber=>({cardHolder:'Cliente Prueba',cardNumber,expMonth:12,expYear:new Date().getUTCFullYear()+2,cvv:'123'});
    const declined=await request('customer','POST',`/bills/${bill.id}/payments`,payment('4000000000000002'),200,{'idempotency-key':randomUUID()});assert.equal(declined.status,'FAILED');await absent();
    const key=randomUUID(),paying=request('customer','POST',`/bills/${bill.id}/payments`,payment('4242424242424242'),200,{'idempotency-key':key});
    let approved;try{
      let pendingPayment=false;for(let i=0;i<100;i++){if(await db.payment.count({where:{billId:bill.id,status:'PENDING'}})){pendingPayment=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
      assert.ok(pendingPayment);await absent();
    }finally{approved=await paying;}
    assert.equal(approved.status,'PAID');
    const ticket=await db.kitchenTicket.findUniqueOrThrow({where:{orderId:row.id}}),storedBill=await db.bill.findUniqueOrThrow({where:{id:bill.id}});
    assert.equal(ticket.branchId,branches[0]);assert.equal(ticket.createdAt.getTime(),storedBill.paidAt.getTime());
    const listed=(await list()).items.find(item=>item.orderId===row.id);assert.equal(listed.enteredAt,ticket.createdAt.toISOString());assert.equal(listed.tableLabel,'Para llevar');
    await request('customer','POST',`/bills/${bill.id}/payments`,payment('4242424242424242'),200,{'idempotency-key':key});
    assert.deepEqual(await db.kitchenTicket.findUnique({where:{orderId:row.id}}),ticket);assert.equal(await db.kitchenTicket.count({where:{orderId:row.id}}),1);
  });
  await t.test('missing branch is reported without bypassing scope',async()=>{
    const missing=randomUUID();await db.user.update({where:{id:users.unassigned.id},data:{branchId:branches[0]}});
    // La sesión de servicio permite probar la inexistencia sin romper una FK de User.
    const {KitchenService}=require('../dist/kitchen/kitchen.service');
    await assert.rejects(new KitchenService(db).list(missing,{}, {userId:users.kitchen.id,role:'KITCHEN',branchId:missing}),error=>error.status===404);
    await list('','kitchen',missing,403);
  });
  await t.test('logged out session no longer reads kitchen queue',async()=>{
    assert.equal((await fetch(base+'/auth/logout',{method:'POST',headers:{cookie:cookies.kitchen}})).status,204);await list('','kitchen',branches[0],401);
  });
});
