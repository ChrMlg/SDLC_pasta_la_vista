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

test('name and description boundaries and all categories are validated before persistence', async () => {
  const { service, repo } = setup();
  for (const name of ['', ' ', 'a', 'x'.repeat(81), 12, null]) {
    await assert.rejects(service.create(branchA, manager, { ...baseInput, name }), (error: unknown) =>
      error instanceof MenuError && error.status === 400 && error.field === 'name');
  }
  for (const description of ['x'.repeat(301), 42]) {
    await assert.rejects(service.create(branchA, manager, { ...baseInput, description }), (error: unknown) =>
      error instanceof MenuError && error.status === 400 && error.field === 'description');
  }
  assert.equal(repo.items.length, 0);
  for (const [index, category] of (['STARTER', 'MAIN_COURSE', 'DRINK', 'DESSERT'] as const).entries()) {
    const item = await service.create(branchA, manager, { name: index ? `Item ${index}` : 'x'.repeat(80), category, price: '0.01', description: index ? null : 'x'.repeat(300) });
    assert.equal(item.category, category);
    assert.equal(item.description, index ? null : 'x'.repeat(300));
  }
  const short = await service.create(branchA, manager, { ...baseInput, name: 'ab' });
  assert.equal(short.description, null);
});

test('immutable fields are rejected on update without mutating the item', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  const before = { ...repo.items[0] };
  for (const key of ['id', 'role', 'branchId', 'normalizedName', 'createdById', 'updatedById', 'isAvailable']) {
    await assert.rejects(service.update(branchA, item.id, manager, { [key]: 'x' }), (error: unknown) =>
      error instanceof MenuError && error.status === 400 && error.field === key);
  }
  assert.deepEqual(repo.items[0], before);
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

test('availability contract validates requests, roles and both transitions', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  for (const body of [null, {}, [], { isAvailable: null }, { isAvailable: 'false' }, { isAvailable: false, name: 'x' }]) {
    await assert.rejects(service.availability(branchA, item.id, manager, body), rejects('INVALID_FIELD', 400));
  }
  await assert.rejects(service.availability(branchA, 'invalid', manager, { isAvailable: false }), rejects('INVALID_FIELD', 400));
  for (const role of ['CUSTOMER', 'WAITER', 'KITCHEN'] as const) {
    await assert.rejects(service.availability(branchA, item.id, { ...manager, role }, { isAvailable: false }), rejects('FORBIDDEN', 403));
  }
  await assert.rejects(service.availability(branchB, item.id, manager, { isAvailable: false }), rejects('NOT_FOUND', 404));
  await assert.rejects(service.availability(branchA, item.id, manager, { isAvailable: true }), rejects('AVAILABILITY_CONFLICT', 409));
  const disabled = await service.availability(branchA, item.id, manager, { isAvailable: false });
  assert.deepEqual(Object.keys(disabled).sort(), ['id', 'branchId', 'isAvailable', 'updatedAt', 'updatedById'].sort());
  assert.equal(disabled.updatedById, manager.userId);
  assert.equal(new Date(disabled.updatedAt).toISOString(), disabled.updatedAt);
  await assert.rejects(service.availability(branchA, item.id, manager, { isAvailable: false }), rejects('AVAILABILITY_CONFLICT', 409));
  const enabled = await service.availability(branchA, item.id, { ...manager, role: 'GENERAL_MANAGER', branchId: null }, { isAvailable: true });
  assert.equal(enabled.isAvailable, true);
  assert.deepEqual(repo.changes.map(({ oldValue, newValue }) => [oldValue, newValue]), [[true, false], [false, true]]);
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

test('administrative input rejects invalid prices and immutable fields', async () => {
  const { service } = setup();
  for (const price of ['0', '0.00', '100000', '1.234', '1e2', 'NaN', '-1', '', 1]) {
    await assert.rejects(service.create(branchA, manager, { ...baseInput, price }), (error: unknown) =>
      error instanceof MenuError && error.status === 400 && error.field === 'price');
  }
  for (const price of ['0.01', '99999.99']) {
    const item = await service.create(branchA, manager, { ...baseInput, name: `Price ${price}`, price });
    assert.equal(item.price, price);
  }
  for (const key of ['id', 'branchId', 'normalizedName', 'createdById', 'updatedById', 'isAvailable']) {
    await assert.rejects(service.create(branchA, manager, { ...baseInput, [key]: 'x' }), (error: unknown) =>
      error instanceof MenuError && error.status === 400 && error.field === key);
  }
});

test('partial edits preserve omitted fields, normalize renames, and reject collisions', async () => {
  const { service } = setup();
  const first = await service.create(branchA, manager, baseInput);
  const second = await service.create(branchA, manager, { ...baseInput, name: 'Sopa' });
  await assert.rejects(service.update(branchA, first.id, manager, {}), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.update(branchA, first.id, manager, { isAvailable: false }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.update(branchA, first.id, manager, { name: '  SOPA  ' }), rejects('DUPLICATE_MENU_ITEM', 409));
  const updated = await service.update(branchA, second.id, manager, { description: '' });
  assert.equal(updated.name, 'Sopa');
  assert.equal(updated.price, '12.50');
  assert.equal(updated.description, '');
  assert.deepEqual(Object.keys(updated).sort(), ['id', 'branchId', 'name', 'description', 'category', 'price', 'isAvailable', 'createdAt', 'updatedAt'].sort());
  assert.equal(new Date(updated.updatedAt).toISOString(), updated.updatedAt);
});

test('all administrative operations enforce roles and branch scope', async () => {
  const { service } = setup();
  const item = await service.create(branchA, manager, baseInput);
  const operations = (session: Session, branch = branchA) => [
    () => service.create(branch, session, { ...baseInput, name: 'Otro' }),
    () => service.update(branch, item.id, session, { name: 'Otro' }),
    () => service.get(branch, item.id, session),
    () => service.list(branch, session, {}, true),
  ];
  for (const role of ['CUSTOMER', 'WAITER', 'KITCHEN'] as const) {
    for (const operation of operations({ ...manager, role })) await assert.rejects(operation(), rejects('FORBIDDEN', 403));
  }
  for (const operation of operations(manager, branchB)) await assert.rejects(operation(), rejects('NOT_FOUND', 404));
  const general: Session = { ...manager, role: 'GENERAL_MANAGER', branchId: null };
  await service.create(branchB, general, baseInput);
  await assert.rejects(service.get(branchB, item.id, general), rejects('NOT_FOUND', 404));
  await assert.rejects(service.update(branchB, item.id, general, { name: 'Otro' }), rejects('NOT_FOUND', 404));
});

test('administrative list validates filters and combines them with pagination', async () => {
  const { service } = setup();
  for (let i = 0; i < 20; i++) await service.create(branchA, manager, { ...baseInput, name: `Dish ${String(i).padStart(2, '0')}` });
  const first = await service.list(branchA, manager, { page: '1', search: 'DISH', category: 'MAIN_COURSE', isAvailable: 'true' }, true);
  const second = await service.list(branchA, manager, { page: '2' }, true);
  assert.equal(first.total, 20); assert.equal(first.data.length, 10); assert.equal(second.data.length, 10);
  assert.equal(first.data[0].name, 'Dish 00'); assert.equal(second.data[0].name, 'Dish 10');
  assert.equal((await service.list(branchA, manager, { isAvailable: 'false' }, true)).total, 0);
  for (const query of [{ page: '1.5' }, { page: '0' }, { isAvailable: 'TRUE' }, { category: 'X' }, { search: 'x'.repeat(81) }, { extra: 'x' }]) {
    await assert.rejects(service.list(branchA, manager, query, true), rejects('INVALID_FIELD', 400));
  }
  await assert.rejects(service.get(branchA, 'invalid', manager), rejects('INVALID_FIELD', 400));
});

test('digital menu enforces roles, filters, public shape and empty pages', async () => {
  const { service, repo } = setup();
  const categories = ['STARTER', 'MAIN_COURSE', 'DRINK', 'DESSERT'] as const;
  for (const category of categories) await service.create(branchA, manager, { name: `Plato ${category}`, category, price: '12.50', description: 'Descripción original' });
  await service.create(branchB, { ...manager, branchId: branchB }, { ...baseInput, name: 'Plato ajeno' });
  await service.availability(branchA, repo.items[0].id, manager, { isAvailable: false });
  for (const role of ['CUSTOMER', 'WAITER', 'MANAGER', 'GENERAL_MANAGER'] as const) {
    const session = { ...manager, role, branchId: role === 'CUSTOMER' || role === 'GENERAL_MANAGER' ? null : branchA };
    const result = await service.list(branchA, session, { search: '' }, false);
    assert.equal(result.total, 4);
    assert.equal(result.data[0].price, '12.50');
    assert.deepEqual(Object.keys(result.data[0]).sort(), ['id', 'name', 'description', 'category', 'price', 'isAvailable'].sort());
    assert.equal(result.data.some(item => !item.isAvailable), true);
    for (const category of categories) assert.equal((await service.list(branchA, session, { category }, false)).total, 1);
  }
  for (const role of ['CUSTOMER', 'WAITER'] as const) await assert.rejects(service.list(branchA, { ...manager, role }, {}, true), rejects('FORBIDDEN', 403));
  await assert.rejects(service.list(branchA, { ...manager, role: 'KITCHEN' }, {}, false), rejects('FORBIDDEN', 403));
  for (const role of ['WAITER', 'MANAGER'] as const) await assert.rejects(service.list(branchB, { ...manager, role }, {}, false), rejects('NOT_FOUND', 404));
  await assert.rejects(service.list('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', customer, {}, false), rejects('NOT_FOUND', 404));
  for (const query of [{page:'-1'}, {page:'0'}, {page:'1.5'}, {page:'abc'}, {search:['x']}, {search:'x'.repeat(81)}, {category:'UNKNOWN'}, {isAvailable:'true'}])
    await assert.rejects(service.list(branchA, customer, query, false), rejects('INVALID_FIELD', 400));
  assert.deepEqual(await service.list(branchA, customer, { search: 'ausente', page: '2' }, false), { data: [], total: 0, page: 2, pageSize: 10 });
  assert.deepEqual(await service.list(branchA, customer, { page: '99' }, false), { data: [], total: 4, page: 99, pageSize: 10 });
});
