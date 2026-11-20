import { BranchReviewsService } from './branch-reviews.service';
const branchId='a1111111-1111-4111-8111-111111111111',session={userId:'u',role:'MANAGER' as const,branchId};
function setup(exists=true){const tx={branch:{findUnique:async()=>exists?{id:branchId}:null},review:{count:async()=>11,findMany:jest.fn().mockResolvedValue([])}};return {tx,service:new BranchReviewsService({$transaction:async(fn:any)=>fn(tx)} as any)};}
describe('H25. Consulta de reseñas por sucursal',()=>{
 it('AC1: restringe sucursal y rechaza inexistente o fuera de alcance',async()=>{const {tx,service}=setup();await service.list(branchId,{},session);expect(tx.review.findMany.mock.calls[0][0].where).toEqual({branchId});await expect(setup(false).service.list(branchId,{},session)).rejects.toMatchObject({status:404});await expect(service.list(branchId,{}, {...session,branchId:'other'})).rejects.toMatchObject({status:404});});
 it('AC2: servicio público de consulta no expone actualización ni eliminación',()=>{const {service}=setup();expect('update' in service).toBe(false);expect('delete' in service).toBe(false);});
 it('AC3: rechaza rating y paginación inválidos',async()=>{for(const query of [{rating:'6'},{rating:'0'},{page:'0'},{page:'1.5'}])await expect(setup().service.list(branchId,query,session)).rejects.toMatchObject({status:400});});
 it('AC4: ordena, pagina de diez y selecciona solo datos públicos',async()=>{const {tx,service}=setup();await service.list(branchId,{page:'2'},session);expect(tx.review.findMany).toHaveBeenCalledWith({where:{branchId},skip:10,take:10,orderBy:[{createdAt:'desc'},{id:'asc'}],select:{id:true,rating:true,comment:true,createdAt:true}});});
});
