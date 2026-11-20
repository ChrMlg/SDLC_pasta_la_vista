import { CustomerReservationsService } from './customer-reservations.service';
import { ReservationCancellationService } from './reservation-cancellation.service';
import { assertCancellationAllowed } from './reservation-rules';
const id='b1111111-1111-4111-8111-111111111111',session={userId:'customer',role:'CUSTOMER' as const,branchId:null};
describe('H12. Reservaciones propias',()=>{
 it('AC1: filtra por cliente de sesión',async()=>{const findMany=jest.fn().mockResolvedValue([]);await new CustomerReservationsService({reservation:{findMany}} as any,{} as any).list({},session);expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{customerId:'customer'}}));});
 it('AC2: permite cancelar exactamente dos horas antes',()=>{expect(()=>assertCancellationAllowed('2090-01-01','12:00','CONFIRMED',new Date('2090-01-01T16:00:00Z'))).not.toThrow();});
 it('AC3: rechaza plazo vencido, reserva ajena e inexistente',async()=>{expect(()=>assertCancellationAllowed('2090-01-01','12:00','CONFIRMED',new Date('2090-01-01T16:00:01Z'))).toThrow();for(const [saved,status] of [[null,404],[{customerId:'other'},403]] as const){const tx={$queryRaw:jest.fn(),reservation:{findUnique:async()=>saved}};const service=new ReservationCancellationService({$transaction:async(fn:any)=>fn(tx)} as any,{} as any);await expect(service.cancel(id,{},session,'CUSTOMER')).rejects.toMatchObject({status});}});
});
