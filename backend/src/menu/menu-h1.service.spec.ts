import {assert,MenuService,MenuError,normalizeName,branchA,branchB,manager,customer,baseInput,FakeRepo,setup,rejects,type Session,type MenuInput,type MenuItem,type MenuFilters} from './menu.spec-helper';
describe('H1. Registro y actualización de platillos',()=>{
it('AC1: normalization collapses whitespace and preserves accents', () => {
  assert.equal(normalizeName('  CRÈME   Brûlée  '), 'crème brûlée');
});

it('AC1: name and description boundaries and all categories are validated before persistence', async () => {
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

it('AC1: immutable fields are rejected on update without mutating the item', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  const before = { ...repo.items[0] };
  for (const key of ['id', 'role', 'branchId', 'normalizedName', 'createdById', 'updatedById', 'isAvailable']) {
    await assert.rejects(service.update(branchA, item.id, manager, { [key]: 'x' }), (error: unknown) =>
      error instanceof MenuError && error.status === 400 && error.field === key);
  }
  assert.deepEqual(repo.items[0], before);
});

it('AC1: create validates fields, saves two-place price and detects normalized duplicates', async () => {
  const { service } = setup();
  const item = await service.create(branchA, manager, { ...baseInput, name: '  Pollo   Asado ', price: '12.5' });
  assert.equal(item.price, '12.50'); assert.equal(item.name, 'Pollo Asado'); assert.equal(item.isAvailable, true);
  await assert.rejects(service.create(branchA, manager, { ...baseInput, name: 'pollo asado' }), rejects('DUPLICATE_MENU_ITEM', 409));
  await assert.rejects(service.create(branchA, manager, { ...baseInput, price: '0.001' }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.create(branchA, manager, { ...baseInput, category: 'UNKNOWN' }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.create(branchA, manager, { ...baseInput, name: 'a' }), rejects('INVALID_FIELD', 400));
});

it('AC3/AC4: manager cannot write another branch; customer cannot write', async () => {
  const { service } = setup();
  await assert.rejects(service.create(branchB, manager, baseInput), rejects('NOT_FOUND', 404));
  await assert.rejects(service.create(branchA, customer, baseInput), rejects('FORBIDDEN', 403));
});

it('AC3/AC4: update tracks the editor and cannot move item to another branch', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  await service.update(branchA, item.id, manager, { price: '15' });
  assert.equal(repo.items[0].price, '15.00'); assert.equal(repo.items[0].updatedById, manager.userId);
  await assert.rejects(service.update(branchA, item.id, manager, { branchId: branchB }), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.get(branchB, item.id, { ...manager, branchId: branchB }), rejects('NOT_FOUND', 404));
});

it('AC1: administrative input rejects invalid prices and immutable fields', async () => {
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

it('AC1: partial edits preserve omitted fields, normalize renames, and reject collisions', async () => {
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

it('AC3/AC4: all administrative operations enforce roles and branch scope', async () => {
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

it('AC1: administrative list validates filters and combines them with pagination', async () => {
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


});


describe('H1. Criterios de aceptación del catálogo',()=>{
 it('AC1: valida nombre, categoría y precio con campo de error',async()=>{for(const body of [{...baseInput,name:'x'},{...baseInput,category:'INVALID'},{...baseInput,price:'0.00'},{...baseInput,price:'1.234'}])await expect(setup().service.create(branchA,manager,body)).rejects.toMatchObject({status:400,field:expect.any(String)});});
 it('AC2: duplicado normalizado en la misma sucursal devuelve 409',async()=>{const {service}=setup();await service.create(branchA,manager,baseInput);await expect(service.create(branchA,manager,{...baseInput,name:'  POLLO   ASADO '})).rejects.toMatchObject({status:409});});
 it('AC3: cliente, mesero y cocina no crean',async()=>{for(const role of ['CUSTOMER','WAITER','KITCHEN'])await expect(setup().service.create(branchA,{...manager,role} as any,baseInput)).rejects.toMatchObject({status:403});});
 it('AC4: gerente no modifica otra sucursal',async()=>{await expect(setup().service.create(branchB,manager,baseInput)).rejects.toMatchObject({status:404});});
 it('AC5: actualización audita usuario y fecha',async()=>{const {service,repo}=setup();const created=await service.create(branchA,manager,baseInput);const updated=await service.update(branchA,created.id,manager,{price:'13.00'});expect(updated.updatedAt).toEqual(expect.any(String));expect(repo.items[0].updatedById).toBe(manager.userId);});
 it('AC6: alta disponible y servicio no expone borrado',async()=>{const {service}=setup();expect((await service.create(branchA,manager,baseInput)).isAvailable).toBe(true);expect('delete' in service).toBe(false);});
 it('AC7: precio decimal y página de diez',async()=>{const {service}=setup();await service.create(branchA,manager,baseInput);expect(await service.list(branchA,manager,{},true)).toMatchObject({pageSize:10,total:1,data:[{price:'12.50'}]});});
});
