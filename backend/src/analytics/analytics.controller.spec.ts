import { AnalyticsController } from './analytics.controller';
const a='a1111111-1111-4111-8111-111111111111',b='a2222222-2222-4222-8222-222222222222';
const query={from:'2026-11-01T00:00:00Z',to:'2026-11-17T00:00:00Z',branchIds:a+','+b};
const request={user:{userId:'u',role:'GENERAL_MANAGER',branchId:null}} as any;
function setup(total=10){const sales={read:jest.fn().mockResolvedValue({metrics:[{branchId:a,totalSales:total,orderCount:1,hasData:total>0},{branchId:b,totalSales:total,orderCount:1,hasData:total>0}]})};return {sales,controller:new AnalyticsController({} as any,{} as any,{} as any,sales as any)};}
describe('H32. Comparación de sucursales',()=>{
 it('AC1: deniega acceso a roles no generales',async()=>{await expect(setup().controller.compare(query,{user:{...request.user,role:'MANAGER'}} as any)).rejects.toMatchObject({status:403});});
 it('AC2: consulta dos sucursales con el mismo período',async()=>{const {controller,sales}=setup();await controller.compare(query,request);expect(sales.read).toHaveBeenCalledWith({from:new Date(query.from),to:new Date(query.to)},[a,b]);});
 it('AC3: calcula proporción y devuelve null cuando el total es cero',async()=>{expect((await setup().controller.compare(query,request)).metrics[0].marketShare).toBe(0.5);expect((await setup(0).controller.compare(query,request)).metrics[0].marketShare).toBeNull();});
 it('AC4: rechaza IDs insuficientes, repetidos y rango invertido',async()=>{for(const patch of [{branchIds:a},{branchIds:a+','+a},{branchIds:'bad'},{from:query.to,to:query.from}])await expect(setup().controller.compare({...query,...patch},request)).rejects.toMatchObject({status:422});});
});
