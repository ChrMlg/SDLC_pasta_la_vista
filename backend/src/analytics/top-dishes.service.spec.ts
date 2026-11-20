import { TopDishesService } from './top-dishes.service';
import {requireGeneral} from './dto/analytics-query.dto';
const branchId='a1111111-1111-4111-8111-111111111111',query={from:'2026-11-01T00:00:00Z',to:'2026-11-17T00:00:00Z'};
function setup(empty=false){const tx={orderItem:{groupBy:jest.fn().mockResolvedValue(empty?[]:[{dishId:'dish',_sum:{quantity:3}}])},menuItem:{findMany:jest.fn().mockResolvedValue([{id:'dish',name:'Pasta'}])}};const db={branch:{findUnique:jest.fn().mockResolvedValue({id:branchId})},$transaction:async(fn:any)=>fn(tx)};const sales={read:jest.fn().mockResolvedValue({payments:empty?[]:[{bill:{orders:[{id:'paid-order'}]}}]})};return {tx,db,service:new TopDishesService(db as any,sales as any)};}
describe('H33. Platillos más vendidos',()=>{
 it('AC1: acceso general y sucursal inexistente 404',async()=>{expect(()=>requireGeneral({userId:'u',role:'WAITER',branchId})).toThrow();const {db,service}=setup();db.branch.findUnique.mockResolvedValue(null as any);await expect(service.list(branchId,query)).rejects.toMatchObject({status:404});});
 it('AC2: agrupa solo pedidos pagados y elementos no cancelados en orden de unidades',async()=>{const {tx,service}=setup();await service.list(branchId,query);expect(tx.orderItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({where:{orderId:{in:['paid-order']},status:{not:'CANCELLED'}},orderBy:[{_sum:{quantity:'desc'}},{dishId:'asc'}]}));});
 it('AC3: vacío válido y límite/rango inválido 422',async()=>{await expect(setup(true).service.list(branchId,query)).resolves.toMatchObject({items:[]});for(const patch of [{limit:'0'},{limit:'101'},{from:query.to,to:query.from}])await expect(setup().service.list(branchId,{...query,...patch})).rejects.toMatchObject({status:422});});
 it('AC4: dishId y nombre provienen del MenuItem',async()=>{await expect(setup().service.list(branchId,query)).resolves.toMatchObject({items:[{dishId:'dish',dishName:'Pasta',unitsSold:3}]});});
});
