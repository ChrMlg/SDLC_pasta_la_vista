const assert=require('node:assert/strict');const {test}=require('node:test');const {analyticsFixture}=require('./support/analytics-fixture.cjs');const {performanceRows}=require('../dist/analytics/performance.service');
test('H35 #66: branch performance',{timeout:60000},async t=>{
 const {db,branches,sale,request}=await analyticsFixture(t,35);const route='/analytics/branches/performance?from=2036-01-01T00:00:00Z&to=2036-01-31T23:59:59Z';
 await t.test('permissions, sorting and period validation',async()=>{await request(route,401,null);for(const role of ['customer','waiter','kitchen','manager'])await request(route,403,role);for(const q of ['sortBy=rating','direction=up','sortBy=orderCount&sortBy=totalSales'])await request(route+'&'+q,422);await request('/analytics/branches/performance?from=bad&to=bad',422);});
 await t.test('no data never requires attention',async()=>{const r=await request(route);assert.ok(r.branches.filter(b=>branches.includes(b.branchId)).every(b=>!b.hasData&&b.attention===null&&b.differencePercent===null));});
 const a=await sale({amount:'80',createdAt:'2036-01-02T12:00:00Z'}),b=await sale({branch:1,amount:'120',count:2,createdAt:'2036-01-02T12:00:00Z'});
 await t.test('exactly 80 percent does not require attention; absent branches excluded from average',async()=>{const r=await request(route),aRow=r.branches.find(x=>x.branchId===branches[0]);assert.equal(aRow.averageSales,100);assert.equal(aRow.differencePercent,-20);assert.equal(aRow.attention,false);});
 await db.payment.update({where:{id:a.payment.id},data:{amount:'79.99'}});await db.payment.update({where:{id:b.payment.id},data:{amount:'120.01'}});
 await t.test('strict threshold and sortable orders/sales',async()=>{const r=await request(route);assert.equal(r.branches.find(x=>x.branchId===branches[0]).attention,true);for(const sortBy of ['orderCount','totalSales'])for(const direction of ['asc','desc']){const rows=(await request(route+'&sortBy='+sortBy+'&direction='+direction)).branches;for(let i=1;i<rows.length;i++)assert.ok(direction==='asc'?rows[i-1][sortBy]<=rows[i][sortBy]:rows[i-1][sortBy]>=rows[i][sortBy]);}});
});
test('H35: zero with data differs from absence, and zero average has no percentage',()=>{
 const metric=(id,sales,hasData)=>({branchId:id,branchName:id,totalSales:sales,orderCount:hasData?1:0,hasData});
 const rows=performanceRows([metric('zero',0,true),metric('paid',100,true),metric('absent',0,false)]);
 assert.equal(rows[0].averageSales,50);assert.equal(rows[0].attention,true);assert.equal(rows[0].differencePercent,-100);assert.equal(rows[2].attention,null);
 const zero=performanceRows([metric('zero',0,true)])[0];assert.equal(zero.hasData,true);assert.equal(zero.attention,false);assert.equal(zero.differencePercent,null);
});
