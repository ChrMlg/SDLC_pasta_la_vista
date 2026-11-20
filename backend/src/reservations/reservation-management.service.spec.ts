import { ReservationManagementService } from './reservation-management.service';
import { ReservationCancellationService } from './reservation-cancellation.service';
const branchId='a1111111-1111-4111-8111-111111111111',id='b1111111-1111-4111-8111-111111111111';
const session={userId:'manager',role:'MANAGER' as const,branchId};
function cancellation(patch:any={}){
 const tx:any={$queryRaw:jest.fn(),reservation:{findUnique:jest.fn().mockResolvedValue({id,branchId,customerId:'customer',date:'2090-01-01',startTime:'12:00',status:'CONFIRMED',branch:{name:'Centro'},...patch}),update:jest.fn().mockResolvedValue({id,customerId:'customer',date:'2090-01-01',startTime:'12:00',status:'CANCELLED'})}};
 const db={$transaction:async(fn:any)=>fn(tx)};return {tx,service:new ReservationCancellationService(db as any,{createNotification:jest.fn()} as any)};
}
describe('H11. Ocupación y cancelación gerencial',()=>{
 it('AC1: calcula mesas distintas por bloque y excluye canceladas',async()=>{const tx={branch:{findUnique:async()=>({openingTime:'12:00',closingTime:'14:00'})},table:{count:async()=>4},reservation:{findMany:async()=>[{id,tableId:'t',table:{number:1},startTime:'12:00',endTime:'13:30',status:'CONFIRMED'},{id:'x',tableId:'t2',table:{number:2},startTime:'12:00',endTime:'13:30',status:'CANCELLED'}]}};const service=new ReservationManagementService({$transaction:async(fn:any)=>fn(tx)} as any,{} as any);const result=await service.occupancy(branchId,{date:'2090-01-01'},session);expect(result.slots[0]).toMatchObject({reservedTables:1,availableTables:3,occupancyPercentage:25});});
 it('AC2: gerente no accede a otra sucursal',async()=>{const service=new ReservationManagementService({} as any,{} as any);await expect(service.occupancy('b1111111-1111-4111-8111-111111111111',{},session)).rejects.toMatchObject({status:404});});
 it('AC3: no cancela una reserva con plazo vencido',async()=>{await expect(cancellation({date:'2000-01-01'}).service.cancel(id,{},session,'MANAGEMENT')).rejects.toMatchObject({status:400});});
 it('AC4: rechaza cliente, mesero y cocina',async()=>{for(const role of ['CUSTOMER','WAITER','KITCHEN'])await expect(cancellation().service.cancel(id,{}, {...session,role} as any,'MANAGEMENT')).rejects.toMatchObject({status:403});});
 it('AC5: cancelación actualiza estado dentro de la transacción',async()=>{const {tx,service}=cancellation();await service.cancel(id,{},session,'MANAGEMENT');expect(tx.reservation.update).toHaveBeenCalledWith({where:{id},data:{status:'CANCELLED'}});});
});
export {cancellation,branchId,id};
