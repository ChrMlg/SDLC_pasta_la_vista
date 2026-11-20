import { RatingsSummaryService } from './ratings-summary.service';
const branchId='a1111111-1111-4111-8111-111111111111';
const session={userId:'user',role:'MANAGER' as const,branchId};
describe('H24. Promedio de calificaciones por sucursal',()=>{
  const setup=()=>{const db={branch:{findUnique:jest.fn().mockResolvedValue({id:branchId})},review:{aggregate:jest.fn().mockResolvedValue({_sum:{rating:13},_count:{_all:3}})}};return {db,service:new RatingsSummaryService(db as any)};};
  it('AC3: rechaza un cliente sin consultar la base',async()=>{const {db,service}=setup();await expect(service.summary(branchId,{}, {...session,role:'CUSTOMER'})).rejects.toMatchObject({status:403});expect(db.review.aggregate).not.toHaveBeenCalled();});
  it('AC1: calcula promedio a una decimal y conserva el conteo',async()=>{const {service}=setup();await expect(service.summary(branchId,{},session)).resolves.toMatchObject({averageRating:4.3,reviewCount:3});});
  it('AC1: sin reseñas devuelve null y cero',async()=>{const {db,service}=setup();db.review.aggregate.mockResolvedValue({_sum:{rating:null},_count:{_all:0}} as any);await expect(service.summary(branchId,{},session)).resolves.toMatchObject({averageRating:null,reviewCount:0});});
  it('AC3: impide consultar otra sucursal como gerente',async()=>{const {service}=setup();await expect(service.summary('a2222222-2222-4222-8222-222222222222',{},session)).rejects.toMatchObject({status:404});});
  it('AC2: filtra sucursal y rango en la agregación',async()=>{const {db,service}=setup();await service.summary(branchId,{dateFrom:'2026-11-01',dateTo:'2026-11-17'},session);expect(db.review.aggregate.mock.calls[0][0].where).toMatchObject({branchId,createdAt:expect.any(Object)});});
  it('AC4: rechaza rango invertido o incompleto',async()=>{const {service}=setup();for(const query of [{dateFrom:'2026-11-17',dateTo:'2026-11-01'},{dateFrom:'2026-11-01'}])await expect(service.summary(branchId,query,session)).rejects.toMatchObject({status:400});});
});
