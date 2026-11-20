import { performanceRows, PerformanceService } from './performance.service';
import { requireGeneral } from './dto/analytics-query.dto';
const metric=(totalSales:number,hasData=true)=>({branchId:String(totalSales),branchName:'Sucursal',totalSales,hasData,orderCount:1});
describe('H35. Reportes de desempeño',()=>{
 it('AC1: solo gerencia general puede acceder',()=>{expect(()=>requireGeneral({userId:'u',role:'MANAGER',branchId:null})).toThrow();expect(()=>requireGeneral({userId:'u',role:'GENERAL_MANAGER',branchId:null})).not.toThrow();});
 it('AC2: exactamente 80% no requiere atención',()=>{expect(performanceRows([metric(80),metric(120)])[0].attention).toBe(false);expect(performanceRows([metric(79),metric(121)])[0].attention).toBe(true);});
 it('AC3: distingue ausencia de datos y ventas cero',()=>{const rows=performanceRows([metric(0),metric(100),metric(0,false)]);expect(rows[0].attention).toBe(true);expect(rows[2].attention).toBeNull();expect(rows[0].averageSales).toBe(50);});
 it('AC4: devuelve promedio y diferencia porcentual',()=>{expect(performanceRows([metric(50),metric(150)])[0]).toMatchObject({totalSales:50,averageSales:100,differencePercent:-50,attention:true});});
 it('AC5: rechaza ordenamiento inválido antes de consultar',async()=>{const sales={read:jest.fn()};await expect(new PerformanceService(sales as any).list({from:'2026-11-01T00:00:00Z',to:'2026-11-02T00:00:00Z',sortBy:'invalid'})).rejects.toMatchObject({status:422});expect(sales.read).not.toHaveBeenCalled();});
});
