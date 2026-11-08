import assert from 'node:assert/strict';
import test from 'node:test';
import { MenuService, MenuError, normalizeName, type MenuRepository, type MenuItem, type MenuInput, type MenuFilters, type Session } from '../src/menu/menu.service.ts';

const branchA = '11111111-1111-4111-8111-111111111111';
const branchB = '22222222-2222-4222-8222-222222222222';
const manager: Session = { userId: '33333333-3333-4333-8333-333333333333', role: 'MANAGER', branchId: branchA };
const customer: Session = { userId: '44444444-4444-4444-8444-444444444444', role: 'CUSTOMER', branchId: null };
const baseInput = { name: 'Pollo asado', category: 'MAIN_COURSE', price: '12.50' } as const;

class FakeRepo implements MenuRepository {
  items: MenuItem[] = [];
  changes: { id: string; oldValue: boolean; newValue: boolean; userId: string }[] = [];
  async branchExists(id: string) { return id === branchA || id === branchB; }
  async find(branchId: string, id: string) { return this.items.find(item => item.branchId === branchId && item.id === id) ?? null; }
  async create(branchId: string, input: MenuInput & { normalizedName: string }, _userId: string) {
    if (this.items.some(item => item.branchId === branchId && item.normalizedName === input.normalizedName)) throw { code: 'P2002' };
    const now = new Date();
    const item: MenuItem = { ...input, id: `55555555-5555-4555-8555-${String(this.items.length + 1).padStart(12, '0')}`,
      branchId, description: input.description ?? null, isAvailable: true, createdAt: now, updatedAt: now, updatedById: null };
    this.items.push(item); return item;
  }
  async update(branchId: string, id: string, input: Partial<MenuInput> & { normalizedName?: string }, userId: string) {
    const item = await this.find(branchId, id);
    if (!item) throw { code: 'P2025' };
    if (input.normalizedName && this.items.some(other => other !== item && other.branchId === branchId && other.normalizedName === input.normalizedName)) throw { code: 'P2002' };
    Object.assign(item, input, { updatedById: userId, updatedAt: new Date() }); return item;
  }
  async list(branchId: string, filters: MenuFilters) {
    const items = this.items.filter(item => item.branchId === branchId &&
      (filters.category === undefined || item.category === filters.category) &&
      (filters.isAvailable === undefined || item.isAvailable === filters.isAvailable) &&
      (filters.search === undefined || item.name.toLowerCase().includes(filters.search.toLowerCase())));
    items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { items: items.slice((filters.page - 1) * 10, filters.page * 10), total: items.length };
  }
  async changeAvailability(branchId: string, id: string, desired: boolean, userId: string) {
    const item = await this.find(branchId, id);
    if (!item) return null;
    if (item.isAvailable === desired) return 'conflict' as const;
    this.changes.push({ id, oldValue: item.isAvailable, newValue: desired, userId });
    item.isAvailable = desired; item.updatedById = userId; item.updatedAt = new Date();
    return item;
  }
}
const setup = () => { const repo = new FakeRepo(); return { repo, service: new MenuService(repo) }; };
const rejects = (code: string, status: number) => (error: unknown) => error instanceof MenuError && error.code === code && error.status === status;

test('normalization collapses whitespace and preserves accents', () => {
  assert.equal(normalizeName('  CRÈME   Brûlée  '), 'crème brûlée');
});

test('create validates fields, saves two-place price and detects normalized duplicates', async () => {
  const { service } = setup();
  const item = await service.create(branchA, manager, { ...baseInput, name: '  Pollo   Asado ', price: '12.5' });
  assert.equal(item.price, '12.50'); assert.equal(item.name, 'Pollo Asado'); assert.equal(item.isAvailable, true);
  await assert.rejects(service.create(branchA, manager, { ...baseInput, name: 'pollo asado' }), rejects('DUPLICATE_MENU_ITEM', 409));
  await assert.rejects(service.create(branchA, manager, { ...baseInput, price: '0.001' }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.create(branchA, manager, { ...baseInput, category: 'UNKNOWN' }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.create(branchA, manager, { ...baseInput, name: 'a' }), rejects('INVALID_FIELD', 400));
});

test('manager cannot write another branch; customer cannot write', async () => {
  const { service } = setup();
  await assert.rejects(service.create(branchB, manager, baseInput), rejects('NOT_FOUND', 404));
  await assert.rejects(service.create(branchA, customer, baseInput), rejects('FORBIDDEN', 403));
});

test('update tracks the editor and cannot move item to another branch', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  await service.update(branchA, item.id, manager, { price: '15' });
  assert.equal(repo.items[0].price, '15.00'); assert.equal(repo.items[0].updatedById, manager.userId);
  await assert.rejects(service.update(branchA, item.id, manager, { branchId: branchB }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.get(branchB, item.id, { ...manager, branchId: branchB }), rejects('NOT_FOUND', 404));
});

test('availability changes once, records audit, rejects repeat and cross-branch access', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  const result = await service.availability(branchA, item.id, manager, { isAvailable: false });
  assert.equal(result.isAvailable, false);
  assert.deepEqual(repo.changes[0], { id: item.id, oldValue: true, newValue: false, userId: manager.userId });
  await assert.rejects(service.availability(branchA, item.id, manager, { isAvailable: false }), rejects('AVAILABILITY_CONFLICT', 409));
  await assert.rejects(service.availability(branchB, item.id, { ...manager, branchId: branchB }, { isAvailable: true }), rejects('NOT_FOUND', 404));
});

test('public menu is branch-scoped, paginated and includes unavailable items', async () => {
  const { service } = setup();
  for (let index = 0; index < 12; index++) await service.create(branchA, manager, { ...baseInput, name: `Dish ${String(index).padStart(2, '0')}` });
  await service.create(branchB, { ...manager, branchId: branchB }, { ...baseInput, name: 'Other branch' });
  const first = await service.list(branchA, customer, { page: '1' }, false);
  assert.equal(first.total, 12); assert.equal(first.data.length, 10); assert.equal(first.pageSize, 10);
  assert.equal(first.data[0].name, 'Dish 00');
  const second = await service.list(branchA, customer, { page: '2' }, false);
  assert.equal(second.data.length, 2);
  await service.availability(branchA, second.data[0].id, manager, { isAvailable: false });
  assert.equal((await service.list(branchA, customer, { page: '2' }, false)).data[0].isAvailable, false);
});

test('search ignores case but preserves accent differences', async () => {
  const { service } = setup();
  await service.create(branchA, manager, { ...baseInput, name: 'Café' });
  await service.create(branchA, manager, { ...baseInput, name: 'Cafe' });
  const accented = await service.list(branchA, customer, { search: 'CAFÉ' }, false);
  assert.deepEqual(accented.data.map(item => item.name), ['Café']);
  const plain = await service.list(branchA, customer, { search: 'cafe' }, false);
  assert.deepEqual(plain.data.map(item => item.name), ['Cafe']);
});

test('filters and identifiers reject invalid input', async () => {
  const { service } = setup();
  await assert.rejects(service.list(branchA, customer, { page: '0' }, false), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.list(branchA, customer, { category: 'INVALID' }, false), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.list(branchA, customer, { search: 'x'.repeat(81) }, false), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.list('not-a-uuid', customer, {}, false), rejects('INVALID_FIELD', 400));
});
