const assert=require('node:assert/strict');const {test}=require('node:test');const {randomUUID}=require('node:crypto');const {analyticsFixture}=require('./support/analytics-fixture.cjs');
test('H32 #63: branch comparisons',{timeout:60000},async t=>{
 const {branches,sale,request,period}=await analyticsFixture(t,32);const route='/analytics/branches/compare?'+period+'&branchIds='+branches.slice(0,2).join(',');
 await t.test('authorization and branch set validation',async()=>{await request(route,401,null);for(const r of ['customer','waiter','kitchen','manager'])await request(route,403,r);for(const ids of ['',branches[0],branches[0]+','+branches[0],branches[0]+',bad',branches[0]+','+randomUUID()])await request('/analytics/branches/compare?'+period+'&branchIds='+ids,422);});
 await t.test('empty comparison has null share',async()=>{const r=await request(route);assert.equal(r.metrics.length,2);assert.ok(r.metrics.every(x=>x.marketShare===null&&x.orderCount===0));});
 await sale({amount:'30',count:2});await sale({branch:1,amount:'70'});await sale({branch:2,amount:'999'});await sale({amount:'999',status:'REFUNDED'});
 await t.test('only selected branches contribute to ratio and totals',async()=>{const r=await request(route),a=r.metrics.find(x=>x.branchId===branches[0]),b=r.metrics.find(x=>x.branchId===branches[1]);assert.equal(a.marketShare,0.3);assert.equal(a.totalSales,30);assert.equal(a.orderCount,2);assert.equal(b.marketShare,0.7);assert.equal(r.metrics.length,2);assert.deepEqual(Object.keys(a).sort(),['branchId','branchName','marketShare','orderCount','totalSales']);});
 await t.test('reuses period validation',async()=>{await request('/analytics/branches/compare?from=bad&to=bad&branchIds='+branches.slice(0,2),422);});
});
