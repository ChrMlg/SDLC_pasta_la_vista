import { SalesMetricsService } from './sales-metrics.service';
import { reportPeriod,requireGeneral } from './dto/analytics-query.dto';
import { VerifiedSessionGuard } from '../common/session';
const period={from:new Date('2026-11-01T00:00:00Z'),to:new Date('2026-11-17T00:00:00Z')};
describe('H31. Reportes de ventas por sucursal',()=>{
 it('AC1: deniega otros roles y ausencia de sesión',()=>{expect(()=>requireGeneral({userId:'u',role:'CUSTOMER',branchId:null})).toThrow();expect(()=>new VerifiedSessionGuard().canActivate({switchToHttp:()=>({getRequest:()=>({})})} as any)).toThrow();});
 it('AC2: suma el pago una sola vez sin multiplicarlo por pedidos',async()=>{const payment={findMany:jest.fn().mockResolvedValue([{amount:10,bill:{branchId:'b',orders:[{id:'o1'},{id:'o2'}]}}])};const tx={branch:{findMany:async()=>[{id:'b',name:'Centro'}]},payment};const result=await new SalesMetricsService({$transaction:async(fn:any)=>fn(tx)} as any).read(period);expect(result.metrics[0]).toMatchObject({totalSales:10,orderCount:2,hasData:true});expect(payment.findMany.mock.calls[0][0].where).toMatchObject({status:'PAID',bill:{status:'PAID',orders:{none:{status:'CANCELLED'}}}});});
 it('AC3: rechaza fechas inválidas e intervalo invertido',()=>{for(const query of [{from:'bad',to:'bad'},{from:'2026-11-17T00:00:00Z',to:'2026-11-01T00:00:00Z'}])expect(()=>reportPeriod(query)).toThrow();});
 it('AC4: ausencia de pagos devuelve ceros y error de consulta no se oculta',async()=>{const tx={branch:{findMany:async()=>[{id:'b',name:'Centro'}]},payment:{findMany:async()=>[]}};await expect(new SalesMetricsService({$transaction:async(fn:any)=>fn(tx)} as any).read(period)).resolves.toMatchObject({metrics:[{totalSales:0,orderCount:0,hasData:false}]});await expect(new SalesMetricsService({$transaction:async()=>{throw Error('db unavailable')}} as any).read(period)).rejects.toThrow('db unavailable');});
});
