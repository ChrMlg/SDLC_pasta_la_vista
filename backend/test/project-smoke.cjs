const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { root, loadProjectConfig } = require('../scripts/project-db-config.cjs');
const { seedProjectData } = require('../prisma/seed-project.cjs');
const { projectSnapshot } = require('./project-snapshot.cjs');

async function main() {
  const target = process.argv[2], config = loadProjectConfig(target);
  const variables = Object.fromEntries(JSON.parse(readFileSync(path.join(root, `postman/.env.project.${target}`), 'utf8')).values.map(row => [row.key, row.value]));
  const credentials = JSON.parse(readFileSync(path.join(root, '.env.project.credentials'), 'utf8'));
  const db = new PrismaClient({ datasources: { db: { url: config.DIRECT_URL } } });
  const cookies = {}, roles = ['customer','waiter','kitchen','manager','otherManager','general'];
  let server, checks = 0;
  const base = config.PROJECT_BASE_URL;
  async function request(method, route, expected, role, body) {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookies[role] ? { cookie: cookies[role] } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, expected, `${method} ${route}: HTTP ${response.status}`); checks++;
    return response;
  }
  try {
    const beforeSeed = await projectSnapshot(db);
    await seedProjectData(db, credentials);
    assert.deepEqual(await projectSnapshot(db), beforeSeed); checks++;
    if (process.argv[3] !== '--existing-api') {
    const probe = require('node:net').createServer();
    await new Promise((resolve, reject) => probe.once('error', reject).listen(Number(config.PORT), '127.0.0.1', resolve));
    await new Promise(resolve => probe.close(resolve));
    server = spawn(process.execPath, [path.join(root, 'backend/dist/main.js')], { env: { ...process.env, ...config }, stdio: 'ignore' });
    }
    let ready = false, startupError;
    if (server) server.on('error', error => { startupError = error; });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (startupError || (server && server.exitCode !== null)) throw new Error('La API no inició');
      try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready); checks++;
    for (const role of roles) {
      const response = await request('POST', '/auth/login', 200, null, { email: variables[role + 'Email'], password: variables[role + 'Password'] });
      cookies[role] = response.headers.get('set-cookie').split(';')[0];
    }
    const route = `/management/branches/${variables.branchId}/inventory`, movementRoute = '/management/inventory/movements';
    const input = { branchId: variables.branchId, itemId: variables.itemId, quantity: 1, type: 'IN', reason: 'Verificación H14: entrada de 1 g de arroz' };
    await request('GET', route, 401);
    for (const role of ['customer','waiter','kitchen']) await request('POST', movementRoute, 403, role, input);
    await request('POST', movementRoute, 404, 'otherManager', input);
    for (const quantity of [0, 1.5]) await request('POST', movementRoute, 400, 'manager', { ...input, quantity });
    await request('POST', movementRoute, 400, 'manager', { ...input, reason: '  ' });
    await request('GET', `/management/branches/${variables.otherBranchId}/inventory`, 200, 'general');
    const list = await (await request('GET', route, 200, 'manager')).json();
    assert.ok(list.length === 5 && list.every(row => row.branchId === variables.branchId)); checks++;
    const currentStock = list.find(row => row.id === variables.itemId).currentStock;
    const beforeMovements = await db.inventoryMovement.count({ where: { itemId: variables.itemId } });
    const incoming = await (await request('POST', movementRoute, 201, 'manager', input)).json();
    const updated = await (await request('GET', route, 200, 'manager')).json();
    assert.equal(updated.find(row => row.id === variables.itemId).currentStock, currentStock + 1); checks++;
    // El seed debe conservar también un saldo distinto de la cantidad inicial del catálogo.
    await seedProjectData(db, credentials);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: variables.itemId } })).currentStock, currentStock + 1); checks++;
    assert.equal(await db.inventoryMovement.count({ where: { itemId: variables.itemId } }), beforeMovements + 1); checks++;
    const outgoing = await (await request('POST', movementRoute, 201, 'manager', { ...input, type: 'OUT', reason: 'Verificación H14: salida de 1 g de arroz' })).json();
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: variables.itemId } })).currentStock, currentStock); checks++;
    assert.equal(await db.inventoryMovement.count({ where: { itemId: variables.itemId } }), beforeMovements + 2); checks++;
    assert.equal(await db.inventoryMovement.count({ where: { id: { in: [incoming.id, outgoing.id] }, createdById: incoming.createdById } }), 2); checks++;
    const afterMovements = await projectSnapshot(db);
    await seedProjectData(db, credentials);
    assert.deepEqual(await projectSnapshot(db), afterMovements); checks++;
    assert.equal(await db.inventoryMovement.count({ where: { itemId: variables.itemId } }), beforeMovements + 2); checks++;
    console.log(JSON.stringify({ target, checks, result: 'PASS', stockPreserved: true, movementsRetained: 2, seedRepeatable: true }));
  } finally {
    for (const role of Object.keys(cookies)) {
      try { await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie: cookies[role] }, signal: AbortSignal.timeout(10000) }); } catch {}
    }
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    await db.$disconnect();
  }
}
main().catch(error => { console.error('Verificación persistente falló: ' + (error.code || error.name) + '. Revise el estado antes de repetir movimientos; no se eliminaron registros.'); process.exitCode = 1; });
