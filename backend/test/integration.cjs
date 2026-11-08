// Ejecutar exclusivamente contra PostgreSQL local de pruebas, con migraciones aplicadas.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/credentials');
const { NotificationsService } = require('../dist/notifications/notifications.service');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
  throw new Error('DATABASE_URL debe apuntar a una base PostgreSQL local cuyo nombre termine en _test');
}
const db = new PrismaClient();
const port = Number(process.env.INTEGRATION_PORT || 3319);
const base = `http://127.0.0.1:${port}/api`;
const branchIds = [randomUUID(), randomUUID()];
const userIds = [];
const run = randomUUID();
const cookies = {};
const users = {};
const password = randomBytes(24).toString('hex');
let server, passed = 0;
let serverErrors = "";
async function call(name, role, method, route, body, expected = 200, extra = {}) {
  const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if(response.status===500) console.error('Diagnóstico servidor local:',serverErrors.match(/Code: `[^`]+`[^\n]*/g)?.slice(-1) ?? 'Sin código SQLSTATE');
  assert.equal(response.status, expected, `${name}: HTTP ${response.status}, esperado ${expected}; código ${value?.code ?? ''}`);
  if (expected >= 400) { assert.equal(typeof value.code, 'string'); assert.equal(typeof value.message, 'string'); assert.ok('field' in value); }
  passed++; console.log(`OK ${passed}: ${name}`);
  return { value, response };
}
const req = async (...args) => (await call(...args)).value;
const payment = (cardNumber = '4242424242424242') => ({ cardHolder: 'Cliente Prueba', cardNumber, expMonth: 12, expYear: new Date().getUTCFullYear() + 2, cvv: '123' });
const key = () => ({ 'idempotency-key': randomUUID() });
async function start() {
  // Evita enviar pruebas accidentalmente a otro proceso que ocupe el puerto.
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, [path.join(__dirname, '../dist/main.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data=>{ serverErrors=(serverErrors+data).slice(-10000); });
  server.stderr.on('data', data=>{ serverErrors=(serverErrors+data).slice(-10000); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('La API terminó antes de responder');
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('La API no respondió en 10 segundos');
}
async function fixtures() {
  await db.branch.createMany({ data: branchIds.map((id, i) => ({ id, code: `QA-${run}-${i}`, name: `QA ${i}` })) });
  for (const [label, role, branch] of [['customer','CUSTOMER',null],['otherCustomer','CUSTOMER',null],['waiter','WAITER',0],['otherWaiter','WAITER',1],['kitchen','KITCHEN',0],['otherKitchen','KITCHEN',1],['manager','MANAGER',0],['otherManager','MANAGER',1],['general','GENERAL_MANAGER',null]]) {
    const id = randomUUID(); userIds.push(id);
    users[label] = await db.user.create({ data: { id, email: `${label.toLowerCase()}.${run}@qa.invalid`, passwordHash: await hashPassword(password), role, branchId: branch === null ? null : branchIds[branch], firstName: 'Prueba', lastName: 'Local', phone: '70000000' } });
    const result = await call(`Login ${label}`, null, 'POST', '/auth/login', { email: users[label].email, password });
    cookies[label] = result.response.headers.get('set-cookie').split(';')[0];
    assert.match(result.response.headers.get('set-cookie'), /HttpOnly/i);
  }
}
async function tests() {
  const [branch, otherBranch] = branchIds;
  await req('Health con consulta PostgreSQL', null, 'GET', '/health');
  await req('Sin sesión', null, 'GET', '/notifications', undefined, 401);
  await req('No se confía identidad en cabeceras', null, 'GET', '/notifications', undefined, 401, { 'x-user-id': users.customer.id, 'x-role': 'CUSTOMER' });
  await req('Login incorrecto', null, 'POST', '/auth/login', { email: users.customer.email, password: 'incorrecta' }, 401);
  await req('Registro rechaza escalación de rol', null, 'POST', '/auth/register/customer', { email: `${run}@qa.invalid`, password, role: 'GENERAL_MANAGER' }, 400);
  await req('Registro exige perfil', null, 'POST', '/auth/register/customer', { email: `${run}@qa.invalid`, password }, 400);
  const registration = { email: `registered.${run}@qa.invalid`, password, firstName: 'Cliente', lastName: 'Prueba', phone: '70000001' };
  const registered = await req('Registro válido', null, 'POST', '/auth/register/customer', registration, 201); userIds.push(registered.id);
  await req('Correo duplicado', null, 'POST', '/auth/register/customer', registration, 409);
  await db.user.update({ where: { id: users.otherCustomer.id }, data: { isActive: false } });
  await req('Cuenta desactivada invalida sesión', 'otherCustomer', 'GET', '/notifications', undefined, 401);
  await req('Cuenta desactivada no inicia sesión', null, 'POST', '/auth/login', { email: users.otherCustomer.email, password }, 401);
  await db.user.update({ where: { id: users.otherCustomer.id }, data: { isActive: true } });
  const menuBody = { name: 'Plato QA', description: 'Prueba', category: 'MAIN_COURSE', price: '10.00' };
  const item = await req('H1 crear platillo', 'manager', 'POST', `/branches/${branch}/menu-items`, menuBody, 201);
  await req('H1 nombre normalizado duplicado', 'manager', 'POST', `/branches/${branch}/menu-items`, { ...menuBody, name: '  PLATO   QA ' }, 409);
  for (const role of ['customer','waiter','kitchen']) await req(`H1 rol ${role} no escribe`, role, 'POST', `/branches/${branch}/menu-items`, menuBody, 403);
  await req('H1 gerente ajeno', 'otherManager', 'PATCH', `/branches/${branch}/menu-items/${item.id}`, { price: '12.00' }, 404);
  await req('H1 precio inválido', 'manager', 'PATCH', `/branches/${branch}/menu-items/${item.id}`, { price: '1.234' }, 400);
  await req('H3 menú de sucursal', 'customer', 'GET', `/branches/${branch}/menu`);
  await req('H3 página inválida', 'customer', 'GET', `/branches/${branch}/menu?page=0`, undefined, 400);
  await req('H3 sucursal ajena para personal', 'otherWaiter', 'GET', `/branches/${branch}/menu`, undefined, 404);
  const availability = await Promise.all([0,1].map(() => fetch(`${base}/branches/${branch}/menu-items/${item.id}/availability`, { method: 'PATCH', headers: { cookie: cookies.manager, 'content-type': 'application/json' }, body: JSON.stringify({ isAvailable: false }) })));
  assert.deepEqual(availability.map(r => r.status).sort(), [200,409]); passed++; console.log(`OK ${passed}: H2 concurrencia 200/409`);
  assert.equal(await db.menuAvailabilityChange.count({ where: { menuItemId: item.id } }), 1);
  const takeaway = { branchId: branch, type: 'TAKEAWAY', tableId: null, items: [{ dishId: item.id, quantity: 2 }] };
  await req('H5 platillo no disponible', 'customer', 'POST', '/orders/customer', takeaway, 409);
  await req('H2 rehabilitar', 'manager', 'PATCH', `/branches/${branch}/menu-items/${item.id}/availability`, { isAvailable: true });
  await req('H5 cantidad cero', 'customer', 'POST', '/orders/customer', { ...takeaway, items: [{ dishId: item.id, quantity: 0 }] }, 422);
  await req('H5 identidad inyectada', 'customer', 'POST', '/orders/customer', { ...takeaway, clientId: users.otherCustomer.id }, 422);
  await req('H4 rol incorrecto', 'customer', 'POST', '/orders', takeaway, 403);
  await req('H4 sucursal ajena', 'otherWaiter', 'POST', '/orders', takeaway, 403);
  const order = await req('H5 pedido TAKEAWAY', 'customer', 'POST', '/orders/customer', takeaway, 201);
  assert.equal(await db.kitchenTicket.count({ where: { orderId: order.id } }), 0);
  const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(stored.clientId, users.customer.id); assert.ok(stored.clientLinkedAt);
  assert.equal(await db.notification.count({ where: { userId: users.customer.id, eventKey: `order.created:${order.id}` } }), 1);
  await req('M1 cambio posterior no cambia precio histórico', 'manager', 'PATCH', `/branches/${branch}/menu-items/${item.id}`, { price: '25.00' });
  for (const role of ['manager','general','kitchen']) await req(`H16 ${role} no cierra cuenta`, role, 'POST', `/branches/${branch}/bills`, { orderId: order.id }, 403);
  await req('H16 cuenta de otro cliente', 'otherCustomer', 'POST', `/branches/${branch}/bills`, { orderId: order.id }, 404);
  const bill = await req('H16 cuenta TAKEAWAY propia', 'customer', 'POST', `/branches/${branch}/bills`, { orderId: order.id }, 201);
  assert.equal(bill.subtotal, '20.00'); assert.equal(bill.taxAmount, '2.60'); assert.equal(bill.total, '22.60'); assert.equal(bill.clientId, users.customer.id);
  await req('H16 cierre repetido', 'customer', 'POST', `/branches/${branch}/bills`, { orderId: order.id }, 409);
  await req('H16 consulta ajena', 'otherCustomer', 'GET', `/bills/${bill.id}`, undefined, 404);
  for (const role of ['manager','general','kitchen','otherWaiter']) await req(`H17 ${role} no cobra`, role, 'POST', `/bills/${bill.id}/payments`, payment(), 403, key());
  await req('H17 clave requerida', 'customer', 'POST', `/bills/${bill.id}/payments`, payment(), 400);
  for (const [field, value] of [['cardNumber','1111111111114242'],['cardHolder','A'],['cvv','1'],['expMonth',0],['expYear',2000],['clientId',users.customer.id]])
    await req(`H17 valida ${field}`, 'customer', 'POST', `/bills/${bill.id}/payments`, { ...payment(), [field]: value }, 422, key());
  await req('H17 tarjeta no admitida', 'customer', 'POST', `/bills/${bill.id}/payments`, payment('5555555555554444'), 422, key());
  const failedKey = key();
  const declined = await req('H17 rechazo simulado', 'customer', 'POST', `/bills/${bill.id}/payments`, payment('4000000000000002'), 200, failedKey);
  assert.equal(declined.status,'FAILED'); assert.equal(declined.billStatus,'OPEN'); assert.equal(declined.receiptId,null);
  assert.equal(await db.kitchenTicket.count({ where: { orderId: order.id } }), 0);
  await req('H17 reintento misma clave rechazada', 'customer', 'POST', `/bills/${bill.id}/payments`, payment('4000000000000002'), 200, failedKey);
  const paidKey = key(); const startTime = Date.now();
  const firstPayment = call('H17 pago aprobado', 'customer', 'POST', `/bills/${bill.id}/payments`, payment(), 200, paidKey);
  // Espera el registro PENDING para competir durante los dos segundos de la pasarela.
  for (let i=0;i<100;i++) { if(await db.payment.count({where:{billId:bill.id,status:'PENDING'}})) break; await new Promise(r=>setTimeout(r,20)); }
  await req('H17 pago simultáneo misma clave', 'customer', 'POST', `/bills/${bill.id}/payments`, payment(), 409, paidKey);
  await req('H17 pago simultáneo otra clave', 'customer', 'POST', `/bills/${bill.id}/payments`, payment(), 409, key());
  const approved = (await firstPayment).value;
  assert.ok(Date.now()-startTime >= 1900); assert.equal(approved.status,'PAID'); assert.equal(approved.billStatus,'PAID'); assert.ok(approved.receiptId);
  const replay = await req('H17 idempotencia después del pago', 'customer', 'POST', `/bills/${bill.id}/payments`, payment(), 200, paidKey);
  assert.equal(replay.paymentId, approved.paymentId); assert.equal(replay.receiptId, approved.receiptId);
  await req('H17 cuenta pagada nueva clave', 'customer', 'POST', `/bills/${bill.id}/payments`, payment(), 409, key());
  assert.equal(await db.payment.count({where:{billId:bill.id,status:'PAID'}}),1);
  assert.equal(await db.kitchenTicket.count({where:{orderId:order.id}}),1);
  assert.equal(await db.notification.count({where:{eventKey:`order.queued:${order.id}`,userId:users.kitchen.id}}),1);
  assert.equal(await db.notification.count({where:{eventKey:`order.queued:${order.id}`,userId:users.otherKitchen.id}}),0);
  const receipt = await req('H18 comprobante propio', 'customer','GET',`/me/receipts/${approved.receiptId}`);
  const before = JSON.stringify(receipt.snapshot);
  await req('H18 menú editado después del pago','manager','PATCH',`/branches/${branch}/menu-items/${item.id}`,{name:'Nombre nuevo',price:'30.00'});
  assert.equal(JSON.stringify((await req('H18 comprobante inmutable','customer','GET',`/me/receipts/${approved.receiptId}`)).snapshot),before);
  await req('H18 comprobante ajeno','otherCustomer','GET',`/me/receipts/${approved.receiptId}`,undefined,404);
  const list = await req('H18 listado paginado','customer','GET','/me/receipts?page=1'); assert.equal(list.pageSize,10);assert.equal(list.total,1);
  await req('H18 página inválida','customer','GET','/me/receipts?page=0',undefined,422);
  const pdf = await req('H18 PDF','customer','GET',`/me/receipts/${approved.receiptId}/pdf`); assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  // Exporta solo si se solicita explícitamente para inspección local; no contiene secretos.
  if(process.env.QA_PDF_PATH) require('node:fs').writeFileSync(process.env.QA_PDF_PATH,pdf);
  assert.equal(JSON.stringify(await db.payment.findMany({where:{billId:bill.id}})).includes('4242424242424242'),false);
  const table=await db.table.create({data:{branchId:branch,number:1,status:'AVAILABLE'}});
  await req('H5 mesa sin asignación','customer','POST','/orders/customer',{...takeaway,type:'DINE_IN',tableId:table.id},409);
  await req('Asignación mesa','customer','POST',`/branches/${branch}/tables/${table.id}/select`,undefined,201);
  const dine=await req('H4 pedido de mesero','waiter','POST','/orders',{...takeaway,type:'DINE_IN',tableId:table.id},201);
  assert.equal(await db.kitchenTicket.count({where:{orderId:dine.id}}),1);
  await req('Mesa con pedido de mesero no se libera','customer','DELETE',`/branches/${branch}/tables/${table.id}/select`,undefined,409);
  await req('H16 pedido pendiente impide cierre','waiter','POST',`/branches/${branch}/bills`,{tableId:table.id},409);
  await req('Código malformado','customer','GET','/orders/link-code/incorrecto',undefined,400);
  const link=await req('Código temporal','waiter','POST',`/orders/${dine.id}/link-code`,undefined,201);
  const preview=await req('Resumen código','customer','GET',`/orders/link-code/${link.code}`);assert.equal(preview.tableNumber,1);assert.equal(preview.itemCount,2);
  const linkRace=await Promise.all(['customer','otherCustomer'].map(role=>fetch(base+'/orders/link-code/confirm',{method:'POST',headers:{cookie:cookies[role],'content-type':'application/json'},body:JSON.stringify({code:link.code})})));
  assert.deepEqual(linkRace.map(r=>r.status).sort(),[201,409]);passed++;console.log(`OK ${passed}: código consumido una sola vez`);
  const linked=await db.order.findUniqueOrThrow({where:{id:dine.id}});assert.ok(linked.clientLinkedAt);
  assert.equal((await db.orderLinkCode.findFirstOrThrow({where:{orderId:dine.id}})).createdById,users.waiter.id);
  await req('Código consumido devuelve conflicto','customer','GET',`/orders/link-code/${link.code}`,undefined,409);
  // Fixture de estado: M3 está fuera del alcance, no se simula su implementación.
  await db.order.update({where:{id:dine.id},data:{status:'DELIVERED',deliveredAt:new Date()}});
  await db.kitchenTicket.update({where:{orderId:dine.id},data:{status:'READY'}});
  const dineBill=await req('H16 cierre de mesa entregada','waiter','POST',`/branches/${branch}/bills`,{tableId:table.id},201);
  await req('M2 mesa en cobro no recibe nuevos pedidos','waiter','POST','/orders',{...takeaway,type:'DINE_IN',tableId:table.id},409);
  await req('H17 mesero cobra mesa','waiter','POST',`/bills/${dineBill.id}/payments`,payment(),200,key());
  assert.equal((await db.table.findUniqueOrThrow({where:{id:table.id}})).status,'NEEDS_CLEANING');
  assert.equal((await db.kitchenTicket.findUniqueOrThrow({where:{orderId:dine.id}})).status,'READY');
  const notices=new NotificationsService(db);
  await notices.orderQueued(order.id); await notices.orderQueued(order.id);
  assert.equal(await db.notification.count({where:{eventKey:`order.queued:${order.id}`,userId:users.kitchen.id}}),1);
  await db.order.update({where:{id:order.id},data:{status:'READY'}});await db.kitchenTicket.update({where:{orderId:order.id},data:{status:'READY'}});
  await notices.kitchenStatusCommitted(order.id,'READY'); await notices.kitchenStatusCommitted(order.id,'READY');
  assert.equal(await db.notification.count({where:{eventKey:`order.ready:${order.id}`,userId:users.customer.id}}),1);
  assert.equal(await db.notification.count({where:{eventKey:`order.ready:${order.id}`,userId:users.waiter.id}}),1);
  assert.equal(await db.notification.count({where:{eventKey:`order.ready:${order.id}`,userId:users.otherWaiter.id}}),0);
  await assert.rejects(notices.createNotification({recipientId:users.otherCustomer.id,title:'Ajeno',message:'Ajeno',sourceModule:'ORDERS',eventKey:`order.created:${order.id}`,relatedEntityId:order.id}),e=>e.status===403);
  await req('H27 filtro inválido','customer','GET','/notifications?sourceModule=INVALID',undefined,422);
  await req('H27 destinatario inyectado','customer','GET',`/notifications?userId=${users.otherCustomer.id}`,undefined,422);
  const inbox=await req('H27 filtro de módulo','customer','GET','/notifications?sourceModule=KITCHEN');assert.ok(inbox.data.every(n=>n.sourceModule==='KITCHEN'));
  const own=await req('H27 bandeja ajena aislada','otherCustomer','GET','/notifications');assert.equal(own.data.some(n=>n.relatedEntityId===order.id),false);
  const tracking = await req('H29 seguimiento sucursal','waiter','GET',`/branches/${branch}/orders?status=DELIVERED`);
  assert.ok(tracking.items.some(item=>item.id===dine.id));
  await req('H29 sucursal ajena','otherWaiter','GET',`/branches/${branch}/orders`,undefined,403);
  await req('H29 estado inválido','waiter','GET',`/branches/${branch}/orders?status=INVALID`,undefined,422);
  const kitchenView = await req('H30 cola autorizada','kitchen','GET',`/branches/${branch}/kitchen/orders?status=READY`);
  assert.ok(kitchenView.items.some(item=>item.orderId===order.id));
  await req('H30 mesero no consulta cocina','waiter','GET',`/branches/${branch}/kitchen/orders`,undefined,403);
  await req('H30 sucursal ajena','otherKitchen','GET',`/branches/${branch}/kitchen/orders`,undefined,403);
  await req('H30 estado no operativo','kitchen','GET',`/branches/${branch}/kitchen/orders?status=DELIVERED`,undefined,422);
  await notices.orderDeliveryCommitted(dine.id, 'DELIVERED');
  await notices.orderDeliveryCommitted(dine.id, 'DELIVERED');
  assert.equal(await db.notification.count({where:{eventKey:`order.delivered:${dine.id}`,userId:users.waiter.id}}),1);
  assert.equal(await db.notification.count({where:{eventKey:`order.delivered:${dine.id}`,userId:users.kitchen.id}}),0);
  // Corrige el endpoint legacy sin implementar el flujo nuevo de M3.
  await req('No permite entrega directa desde READY','waiter','PATCH',`/orders/${order.id}/status/DELIVERED`,undefined,409);
  await db.order.update({where:{id:order.id},data:{status:'OUT_FOR_DELIVERY'}});
  await req('Entrega legacy mantiene comanda READY','waiter','PATCH',`/orders/${order.id}/status/DELIVERED`);
  assert.equal((await db.kitchenTicket.findUniqueOrThrow({where:{orderId:order.id}})).status,'READY');
  const raceBills=[];
  for (let i=0;i<2;i++) {
    const pendingOrder=await req('Pedido para carrera de correlativo','customer','POST','/orders/customer',takeaway,201);
    raceBills.push(await req('Cuenta para carrera de correlativo','customer','POST',`/branches/${branch}/bills`,{orderId:pendingOrder.id},201));
  }
  const racedPayments=await Promise.all(raceBills.map(raceBill=>req('Pago concurrente de cuentas distintas','customer','POST',`/bills/${raceBill.id}/payments`,payment(),200,key())));
  const receipts=await db.receipt.findMany({where:{id:{in:racedPayments.map(p=>p.receiptId)}}});
  assert.equal(new Set(receipts.map(r=>r.sequence)).size,2);
  const timeoutOrder=await req('Pedido para timeout','customer','POST','/orders/customer',takeaway,201);
  const timeoutBill=await req('Cuenta para timeout','customer','POST',`/branches/${branch}/bills`,{orderId:timeoutOrder.id},201);
  const expired=await db.payment.create({data:{billId:timeoutBill.id,userId:users.customer.id,idempotencyKey:randomUUID(),amount:timeoutBill.total,cardLast4:'4242',createdAt:new Date(Date.now()-31000)}});
  await req('Reintenta pago con intento vencido','customer','POST',`/bills/${timeoutBill.id}/payments`,payment(),200,key());
  const expiredResult=await db.payment.findUniqueOrThrow({where:{id:expired.id}});
  assert.equal(expiredResult.status,'FAILED');assert.equal(expiredResult.failureCode,'GATEWAY_TIMEOUT');
  await req('Logout','customer','POST','/auth/logout',undefined,204);
  await req('Cookie revocada','customer','GET','/notifications',undefined,401);
}
async function cleanup() {
  if(server && server.exitCode===null) {server.kill('SIGTERM');await once(server,'exit');}
  // Elimina exclusivamente los fixtures identificados por UUID de esta ejecución.
  await db.notification.deleteMany({where:{userId:{in:userIds}}});
  await db.authSession.deleteMany({where:{userId:{in:userIds}}});
  await db.receipt.deleteMany({where:{branchId:{in:branchIds}}});
  await db.payment.deleteMany({where:{bill:{branchId:{in:branchIds}}}});
  await db.orderLinkCode.deleteMany({where:{order:{branchId:{in:branchIds}}}});
  await db.kitchenTicket.deleteMany({where:{order:{branchId:{in:branchIds}}}});
  await db.orderItem.deleteMany({where:{order:{branchId:{in:branchIds}}}});
  await db.order.deleteMany({where:{branchId:{in:branchIds}}});
  await db.bill.deleteMany({where:{branchId:{in:branchIds}}});
  await db.receiptCounter.deleteMany({where:{branchId:{in:branchIds}}});
  await db.tableAssignment.deleteMany({where:{table:{branchId:{in:branchIds}}}});
  await db.table.deleteMany({where:{branchId:{in:branchIds}}});
  await db.menuAvailabilityChange.deleteMany({where:{menuItem:{branchId:{in:branchIds}}}});
  await db.menuItem.deleteMany({where:{branchId:{in:branchIds}}});
  await db.user.deleteMany({where:{id:{in:userIds}}});
  await db.branch.deleteMany({where:{id:{in:branchIds}}});
}
(async()=>{try{await start();await fixtures();await tests();console.log(`RESULTADO: ${passed} comprobaciones HTTP/concurrencia aprobadas; además aserciones de persistencia.`);}finally{await cleanup();await db.$disconnect();}})().catch(error=>{console.error(error);process.exitCode=1;});
