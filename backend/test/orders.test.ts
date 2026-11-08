import assert from 'node:assert/strict';
import test from 'node:test';
import { OrdersService, OrderError, type OrdersRepository, type OrderInput, type CreatedOrder, type LinkPreview } from '../src/orders/orders.service.ts';
import type { Session } from '../src/menu/menu.service.ts';

const branch = '11111111-1111-4111-8111-111111111111';
const otherBranch = '22222222-2222-4222-8222-222222222222';
const table = '33333333-3333-4333-8333-333333333333';
const dish = '44444444-4444-4444-8444-444444444444';
const waiter: Session = { userId: '55555555-5555-4555-8555-555555555555', role: 'WAITER', branchId: branch };
const customer: Session = { userId: '66666666-6666-4666-8666-666666666666', role: 'CUSTOMER', branchId: null };
const dineIn = { branchId: branch, type: 'DINE_IN', tableId: table, items: [{ dishId: dish, quantity: 2, note: 'Sin cebolla' }] };
const rejects = (status: number, code: string) => (error: unknown) => error instanceof OrderError && error.status === status && error.code === code;
class FakeRepository implements OrdersRepository {
  saved: OrderInput[] = [];
  link: LinkPreview | null = null;
  hash = '';
  async branchExists(id: string) { return id === branch; }
  async create(input: OrderInput, _userId: string, _customer: boolean): Promise<CreatedOrder> {
    this.saved.push(input);
    return { id: '77777777-7777-4777-8777-777777777777', orderNumber: 1, status: 'PENDING', createdAt: new Date('2026-11-04T00:00:00Z'), total: '25.00', type: input.type, branchId: input.branchId, tableId: input.tableId };
  }
  async findLinkableOrder(id: string, branchId: string) { return branchId === branch ? { id, clientId: null, type: 'DINE_IN' as const } : null; }
  async saveLinkCode(_orderId: string, hash: string, expiresAt: Date) {
    this.hash = hash;
    this.link = { orderId: '77777777-7777-4777-8777-777777777777', orderNumber: 1, branchId: branch, expiresAt, usedAt: null, clientId: null };
  }
  async previewCode(hash: string) { return hash === this.hash ? this.link : null; }
  async confirmCode(hash: string, customerId: string) {
    if (hash !== this.hash) return null;
    if (!this.link || this.link.clientId) return 'conflict' as const;
    this.link.clientId = customerId; this.link.usedAt = new Date();
    return this.link;
  }
}

test('waiter creates DINE_IN; customer creates TAKEAWAY with server-derived identity', async () => {
  const repo = new FakeRepository(); const service = new OrdersService(repo);
  const first = await service.create(dineIn, waiter, false);
  assert.equal(first.orderNumber, 1); assert.equal(first.total, '25.00');
  const second = await service.create({ ...dineIn, type: 'TAKEAWAY', tableId: null }, customer, true);
  assert.equal(second.type, 'TAKEAWAY'); assert.equal(repo.saved.length, 2);
});

test('rejects invalid input before persistence', async () => {
  const repo = new FakeRepository(); const service = new OrdersService(repo);
  for (const body of [
    { ...dineIn, items: [] }, { ...dineIn, items: [{ dishId: dish, quantity: 0 }] },
    { ...dineIn, items: [{ dishId: dish, quantity: 1.5 }] }, { ...dineIn, clientId: customer.userId },
    { ...dineIn, type: 'TAKEAWAY' }, { ...dineIn, tableId: null },
  ]) await assert.rejects(service.create(body, waiter, false), rejects(422, 'INVALID_FIELD'));
  assert.equal(repo.saved.length, 0);
});

test('checks role, waiter branch and branch existence', async () => {
  const service = new OrdersService(new FakeRepository());
  await assert.rejects(service.create(dineIn, customer, false), rejects(403, 'FORBIDDEN'));
  await assert.rejects(service.create({ ...dineIn, branchId: otherBranch }, waiter, false), rejects(403, 'FORBIDDEN'));
  await assert.rejects(service.create({ ...dineIn, branchId: otherBranch }, customer, true), rejects(404, 'NOT_FOUND'));
});

test('link code is hashed, can be previewed and consumed once', async () => {
  const repo = new FakeRepository(); const service = new OrdersService(repo);
  const { code } = await service.createLinkCode('77777777-7777-4777-8777-777777777777', waiter);
  assert.match(code, /^[A-HJ-NP-Z2-9]{12}$/);
  assert.notEqual(repo.hash, code); assert.equal(repo.hash.length, 64);
  assert.equal((await service.previewCode(code, customer)).orderNumber, 1);
  assert.equal((await service.confirmCode({ code }, customer)).orderNumber, 1);
  await assert.rejects(service.confirmCode({ code }, customer), rejects(409, 'LINK_CODE_CONFLICT'));
  await assert.rejects(service.previewCode(code, customer), rejects(404, 'NOT_FOUND'));
});

test('queue notice follows committed DINE_IN order and a delivery error does not undo it', async () => {
  const repo = new FakeRepository();
  const notified: string[] = [];
  const service = new OrdersService(repo, { orderQueued: async id => {
    assert.equal(repo.saved.length, 1);
    notified.push(id);
  } });
  await service.create(dineIn, waiter, false);
  await service.create({ ...dineIn, type: 'TAKEAWAY', tableId: null }, customer, true);
  assert.deepEqual(notified, ['77777777-7777-4777-8777-777777777777']);
  const originalError = console.error;
  console.error = () => {};
  try {
    const failing = new OrdersService(new FakeRepository(), { orderQueued: async () => { throw new Error('delivery failed'); } });
    assert.equal((await failing.create(dineIn, waiter, false)).orderNumber, 1);
  } finally { console.error = originalError; }
});
