import { ReviewsService } from './reviews.service';
const id='a1111111-1111-4111-8111-111111111111',session={userId:'customer',role:'CUSTOMER' as const,branchId:null};
function setup(patch:any={}){
 const order=patch===null?null:{id,branchId:'branch',clientId:'customer',status:'DELIVERED',deliveredAt:new Date('2026-11-01T12:00:00Z'),review:null,...patch};
 const tx={$queryRaw:jest.fn(),order:{findUnique:async()=>order},review:{create:jest.fn().mockImplementation(async({data})=>data)}};
 return {tx,service:new ReviewsService({$transaction:async(fn:any)=>fn(tx)} as any)};
}
describe('H23. Registro de reseñas y calificaciones',()=>{
 beforeEach(()=>{jest.useFakeTimers();jest.setSystemTime(new Date('2026-11-01T12:00:00Z'));});afterEach(()=>jest.useRealTimers());
 it('AC1: oculta pedidos inexistentes o ajenos con 404',async()=>{for(const patch of [null,{clientId:'other'}])await expect(setup(patch).service.create(id,{rating:5},session)).rejects.toMatchObject({status:404});});
 it('AC2: rechaza pedido sin vincular, sin entrega o fuera de 720 horas; permite igualdad',async()=>{for(const patch of [{clientId:null},{status:'READY'},{deliveredAt:null},{deliveredAt:new Date('2026-10-02T11:59:59Z')}])await expect(setup(patch).service.create(id,{rating:5},session)).rejects.toMatchObject({status:409});await expect(setup({deliveredAt:new Date('2026-10-02T12:00:00Z')}).service.create(id,{rating:5},session)).resolves.toMatchObject({rating:5});});
 it('AC3: rechaza segunda reseña sin escribir',async()=>{const {tx,service}=setup({review:{id:'existing'}});await expect(service.create(id,{rating:5},session)).rejects.toMatchObject({status:409,code:'REVIEW_ALREADY_EXISTS'});expect(tx.review.create).not.toHaveBeenCalled();});
 it('AC4: valida entero 1 a 5 y comentario de hasta 500 caracteres',async()=>{for(const body of [{rating:0},{rating:6},{rating:1.5},{rating:5,comment:'x'.repeat(501)}])await expect(setup().service.create(id,body,session)).rejects.toMatchObject({status:400});});
 it('AC5: solo cliente; identidad y sucursal se obtienen del servidor',async()=>{await expect(setup().service.create(id,{rating:5},{...session,role:'WAITER'})).rejects.toMatchObject({status:403});await expect(setup().service.create(id,{rating:5,clientId:'other'},session)).rejects.toMatchObject({status:400});await expect(setup().service.create(id,{rating:5},session)).resolves.toMatchObject({clientId:'customer',branchId:'branch'});});
});
