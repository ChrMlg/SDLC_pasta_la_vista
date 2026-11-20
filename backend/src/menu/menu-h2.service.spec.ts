import {assert,MenuService,MenuError,normalizeName,branchA,branchB,manager,customer,baseInput,FakeRepo,setup,rejects,type Session,type MenuInput,type MenuItem,type MenuFilters} from './menu.spec-helper';
describe('H2. Gestión de disponibilidad',()=>{
it('AC3/AC4/AC5: availability changes once, records audit, rejects repeat and cross-branch access', async () => {
  const { service, repo } = setup();
  const item = await service.create(branchA, manager, baseInput);
  const result = await service.availability(branchA, item.id, manager, { isAvailable: false });
  assert.equal(result.isAvailable, false);
  assert.deepEqual(repo.changes[0], { id: item.id, oldValue: true, newValue: false, userId: manager.userId });
  await assert.rejects(service.availability(branchA, item.id, manager, { isAvailable: false }), rejects('AVAILABILITY_CONFLICT', 409));
  await assert.rejects(service.availability(branchB, item.id, { ...manager, branchId: branchB }, { isAvailable: true }), rejects('NOT_FOUND', 404));
});

it('AC1/AC2: availability contract validates requests, roles and both transitions', async () => {
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


});


describe('H2. Criterios de aceptación de disponibilidad',()=>{
 it('AC1: cliente, mesero y cocina no cambian disponibilidad',async()=>{const {service}=setup();const item=await service.create(branchA,manager,baseInput);for(const role of ['CUSTOMER','WAITER','KITCHEN'])await expect(service.availability(branchA,item.id,{...manager,role} as any,{isAvailable:false})).rejects.toMatchObject({status:403});});
 it('AC2: gerente de otra sucursal recibe 404',async()=>{const {service}=setup();const item=await service.create(branchA,manager,baseInput);await expect(service.availability(branchA,item.id,{...manager,branchId:branchB},{isAvailable:false})).rejects.toMatchObject({status:404});});
 it('AC3: rechaza repetir el estado',async()=>{const {service}=setup();const item=await service.create(branchA,manager,baseInput);await expect(service.availability(branchA,item.id,manager,{isAvailable:true})).rejects.toMatchObject({status:409});});
 it('AC4: dos cambios simultáneos solo aplican una modificación',async()=>{const {service,repo}=setup();const item=await service.create(branchA,manager,baseInput);const results=await Promise.allSettled([service.availability(branchA,item.id,manager,{isAvailable:false}),service.availability(branchA,item.id,manager,{isAvailable:false})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(repo.changes).toHaveLength(1);});
 it('AC5: registra valor anterior, nuevo y usuario',async()=>{const {service,repo}=setup();const item=await service.create(branchA,manager,baseInput);const result=await service.availability(branchA,item.id,manager,{isAvailable:false});expect(repo.changes).toEqual([{id:item.id,oldValue:true,newValue:false,userId:manager.userId}]);expect(result.updatedAt).toEqual(expect.any(String));});
});


import {PrismaOrdersRepository} from '../orders/prisma-orders.repository';
const branchId='a1111111-1111-4111-8111-111111111111',dishId='b1111111-1111-4111-8111-111111111111';
describe('H2. Contrato de disponibilidad con pedidos',()=>{
 it('AC6: no crea pedido con platillo deshabilitado ni de otra sucursal',async()=>{for(const dish of [{id:dishId,branchId,isAvailable:false},{id:dishId,branchId:'other',isAvailable:true}]){const tx={$queryRaw:jest.fn().mockResolvedValue([dish]),order:{create:jest.fn()}};const repo=new PrismaOrdersRepository({$transaction:async(fn:any)=>fn(tx)} as any);await expect(repo.create({branchId,tableId:null,type:'TAKEAWAY',items:[{dishId,quantity:1,note:null}]},'customer',true)).rejects.toMatchObject({status:409});expect(tx.order.create).not.toHaveBeenCalled();}});
});
