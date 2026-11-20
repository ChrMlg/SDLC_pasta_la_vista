import {PeakHoursService} from './peak-hours.service';
import {requireGeneral} from './dto/analytics-query.dto';
const branchId='a1111111-1111-4111-8111-111111111111',query={branchIds:branchId,from:'2026-11-17T12:00:00Z',to:'2026-11-17T15:00:00Z'};
function service(empty=false){return new PeakHoursService({read:async()=>({metrics:[{branchId,branchName:'Centro'}],payments:empty?[]:[{bill:{branchId,orders:[{id:'o1',createdAt:new Date('2026-11-17T13:05:00Z')},{id:'o2',createdAt:new Date('2026-11-17T13:35:00Z')},{id:'o3',createdAt:new Date('2026-11-17T14:00:00Z')}]}}]})} as any);}
describe('H34. Reportes temporales',()=>{
 it('AC1: solo gerente general',()=>{expect(()=>requireGeneral({userId:'u',role:'MANAGER',branchId})).toThrow();});
 it('AC2: agrupa 60 minutos y entrega top tres con desempate ascendente',async()=>{const result=await service().list(query);expect(result.intervalMinutes).toBe(60);expect(result.branches[0].slots.map(s=>s.orderCount)).toEqual([2,1,0]);expect(result.branches[0].slots[0].startAt).toBe('2026-11-17T07:00:00.000-06:00');});
 it('AC3: sin pedidos conserva slots UTC-6 con cero',async()=>{const result=await service(true).list(query);expect(result.branches[0].slots).toEqual([{startAt:'2026-11-17T06:00:00.000-06:00',orderCount:0},{startAt:'2026-11-17T07:00:00.000-06:00',orderCount:0},{startAt:'2026-11-17T08:00:00.000-06:00',orderCount:0}]);});
 it('AC4: sucursal y rango inválidos no se consultan',async()=>{for(const patch of [{branchIds:'bad'},{from:query.to,to:query.from}])await expect(service().list({...query,...patch})).rejects.toMatchObject({status:422});});
});
