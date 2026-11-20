import {assert,MenuService,MenuError,normalizeName,branchA,branchB,manager,customer,baseInput,FakeRepo,setup,rejects,type Session,type MenuInput,type MenuItem,type MenuFilters} from './menu.spec-helper';
describe('H3. Consulta del menú digital',()=>{
it('AC1: public menu is branch-scoped, paginated and includes unavailable items', async () => {
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

it('AC1: search ignores case but preserves accent differences', async () => {
  const { service } = setup();
  await service.create(branchA, manager, { ...baseInput, name: 'Café' });
  await service.create(branchA, manager, { ...baseInput, name: 'Cafe' });
  const accented = await service.list(branchA, customer, { search: 'CAFÉ' }, false);
  assert.deepEqual(accented.data.map(item => item.name), ['Café']);
  const plain = await service.list(branchA, customer, { search: 'cafe' }, false);
  assert.deepEqual(plain.data.map(item => item.name), ['Cafe']);
});

it('AC1: filters and identifiers reject invalid input', async () => {
  const { service } = setup();
  await assert.rejects(service.list(branchA, customer, { page: '0' }, false), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.list(branchA, customer, { category: 'INVALID' }, false), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.list(branchA, customer, { search: 'x'.repeat(81) }, false), rejects('INVALID_FIELD', 400));
  await assert.rejects(service.list('not-a-uuid', customer, {}, false), rejects('INVALID_FIELD', 400));
});

it('AC1: digital menu enforces roles, filters, public shape and empty pages', async () => {
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

});


describe('H3. Criterios de aceptación del menú digital',()=>{
 it('AC1: lista únicamente la sucursal consultada',async()=>{const {service}=setup();await service.create(branchA,manager,baseInput);await expect(service.list(branchB,customer,{},false)).resolves.toMatchObject({data:[],total:0});});
 it('AC2: sucursal inexistente o fuera del alcance recibe 404',async()=>{const {service}=setup();await expect(service.list('99999999-9999-4999-8999-999999999999',customer,{},false)).rejects.toMatchObject({status:404});await expect(service.list(branchB,manager,{},false)).rejects.toMatchObject({status:404});});
 it('AC3: pedidos rechazan platillo deshabilitado aunque la interfaz lo envíe',async()=>{const {PrismaOrdersRepository}=await import('../orders/prisma-orders.repository');const dishId='b1111111-1111-4111-8111-111111111111';const tx={$queryRaw:jest.fn().mockResolvedValue([{id:dishId,branchId:branchA,isAvailable:false}]),order:{create:jest.fn()}};await expect(new PrismaOrdersRepository({$transaction:async(fn:any)=>fn(tx)} as any).create({branchId:branchA,type:'TAKEAWAY',tableId:null,items:[{dishId,quantity:1,note:null}]},customer.userId,true)).rejects.toMatchObject({status:409});expect(tx.order.create).not.toHaveBeenCalled();});
 it('AC4: rechaza búsqueda, categoría y página inválidas',async()=>{for(const query of [{search:'x'.repeat(81)},{category:'INVALID'},{page:'0'}])await expect(setup().service.list(branchA,customer,query,false)).rejects.toMatchObject({status:400});});
});
