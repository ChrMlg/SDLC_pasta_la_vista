import { KitchenService } from './kitchen.service';
import {branchId,kitchen} from './kitchen.spec-helper';
function setup(){const enteredAt=new Date('2026-11-17T12:00:00Z');const findMany=jest.fn().mockResolvedValue([{status:'PENDING',createdAt:enteredAt,order:{id:'o',orderNumber:1,type:'TAKEAWAY',updatedAt:enteredAt,items:[]}}]);return {enteredAt,findMany,service:new KitchenService({branch:{count:async()=>1},kitchenTicket:{findMany}} as any)};}
describe('H6. Visualización de comandas pendientes',()=>{
 it('AC1: filtra por sucursal de ruta y pedido',async()=>{const {service,findMany}=setup();await service.list(branchId,{},kitchen);expect(findMany.mock.calls[0][0].where).toMatchObject({branchId,order:{branchId}});});
 it('AC2: enteredAt usa la creación de comanda',async()=>{const {service,enteredAt}=setup();expect((await service.list(branchId,{},kitchen)).items[0].enteredAt).toBe(enteredAt);});
 it('AC3: consulta excluye para llevar sin pago PAID',async()=>{const {service,findMany}=setup();await service.list(branchId,{},kitchen);expect(findMany.mock.calls[0][0].where.order.OR).toEqual([{type:'DINE_IN'},{type:'TAKEAWAY',bill:{status:'PAID'}}]);});
 it('AC4: deniega sucursal ajena y rol incorrecto',async()=>{for(const patch of [{branchId:'other'},{role:'WAITER'}])await expect(setup().service.list(branchId,{}, {...kitchen,...patch} as any)).rejects.toMatchObject({status:403});});
 it('AC5: rechaza estado desconocido',async()=>{await expect(setup().service.list(branchId,{status:'UNKNOWN'},kitchen)).rejects.toMatchObject({status:422});});
 it('AC6: orden ascendente y estados predeterminados',async()=>{const {service,findMany}=setup();await service.list(branchId,{},kitchen);expect(findMany.mock.calls[0][0]).toMatchObject({where:{status:{in:['PENDING','IN_PREPARATION']}},orderBy:[{createdAt:'asc'},{orderId:'asc'}]});});
});
