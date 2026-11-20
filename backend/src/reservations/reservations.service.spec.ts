import { ReservationsService } from './reservations.service';
const branchId='a1111111-1111-4111-8111-111111111111';
const session={userId:'customer',role:'CUSTOMER' as const,branchId:null};
const input={branchId,date:'2090-01-01',time:'12:00',partySize:4};
function setup(conflict=0){
 const tx:any={$queryRaw:jest.fn().mockResolvedValue([{id:'table',number:1,capacity:4}]),branch:{findUnique:jest.fn().mockResolvedValue({id:branchId,name:'Centro',openingTime:'12:00',closingTime:'22:00'})},reservation:{count:jest.fn().mockResolvedValue(conflict),create:jest.fn().mockImplementation(async({data})=>({id:'reservation',...data}))}};
 const notifications={createNotification:jest.fn()};const db={$transaction:async(fn:any)=>fn(tx)};
 return {tx,notifications,service:new ReservationsService(db as any,notifications as any)};
}
describe('H10. Registro de reservación de mesa por el cliente',()=>{
 it('AC1: asigna capacidad suficiente y duración de 90 minutos',async()=>{const {service,tx}=setup();await expect(service.create(input,session)).resolves.toMatchObject({endTime:'13:30',tableId:'table'});expect(tx.reservation.count).toHaveBeenCalledWith({where:{tableId:'table',date:input.date,status:{in:['PENDING','CONFIRMED']},startTime:{lt:'13:30'},endTime:{gt:'12:00'}}});});
 it('AC2: si la última mesa ya tiene reserva, devuelve 409 sin crear otra',async()=>{const {service,tx}=setup(1);await expect(service.create(input,session)).rejects.toMatchObject({status:409});expect(tx.reservation.create).not.toHaveBeenCalled();expect(tx.$queryRaw).toHaveBeenCalled();});
 it('AC3: rechaza pasado, horario y cantidad fuera de capacidad',async()=>{for(const patch of [{date:'2000-01-01'},{time:'11:00'},{partySize:0},{partySize:5}])await expect(setup().service.create({...input,...patch},session)).rejects.toMatchObject({status:400});});
 it('AC4: personal no puede registrar como cliente',async()=>{for(const role of ['WAITER','KITCHEN','MANAGER','GENERAL_MANAGER'])await expect(setup().service.create(input,{...session,role} as any)).rejects.toMatchObject({status:403});});
 it('AC5: toma cliente de sesión y crea CONFIRMED',async()=>{const {service}=setup();await expect(service.create(input,session)).resolves.toMatchObject({customerId:'customer',status:'CONFIRMED'});await expect(service.create({...input,customerId:'other'},session)).rejects.toMatchObject({status:400});});
 it('AC6: notifica la reserva persistida',async()=>{const {service,notifications}=setup();await service.create(input,session);expect(notifications.createNotification).toHaveBeenCalledWith(expect.objectContaining({eventKey:'reservation.confirmed:reservation',recipientId:'customer'}));});
});
