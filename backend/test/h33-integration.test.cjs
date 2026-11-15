const assert=require('node:assert/strict');const {test}=require('node:test');const {randomUUID}=require('node:crypto');const {analyticsFixture}=require('./support/analytics-fixture.cjs');
test('H33 #64: top dishes',{timeout:60000},async t=>{
 const {db,branches,dishes,sale,request,period}=await analyticsFixture(t,33);const route=`/analytics/branches/${branches[0]}/top-dishes?${period}`;
 await t.test('auth, missing branch and invalid limit/range',async()=>{await request(route,401,null);for(const r of ['customer','waiter','kitchen','manager'])await request(route,403,r);await request(`/analytics/branches/${randomUUID()}/top-dishes?${period}`,404);for(const limit of ['0','-1','101','1.5','bad',''])await request(route+'&limit='+limit,422);await request(`/analytics/branches/${branches[0]}/top-dishes?from=bad&to=bad`,422);});
 await t.test('no sales produces empty ranking',async()=>{assert.deepEqual((await request(route)).items,[]);});
 const a=await sale({count:2,quantities:[3,1]});
 await db.payment.create({data:{billId:a.bill.id,userId:a.payment.userId,idempotencyKey:randomUUID(),status:'PAID',amount:'10',cardLast4:'4242',createdAt:a.payment.createdAt}});
 await sale({quantities:[1,5]});await sale({status:'FAILED',quantities:[90,90]});await sale({cancelled:true,quantities:[90,90]});await sale({branch:1,quantities:[90,90]});await sale({createdAt:'2034-01-01T00:00:00Z',quantities:[90,90]});
 const cancelledItem=await sale({quantities:[90,2]});await db.orderItem.updateMany({where:{orderId:cancelledItem.orders[0].id,dishId:dishes[0][0].id},data:{status:'CANCELLED'}});
 await t.test('units, not payments/orders; cancelled items excluded and deterministic ranking',async()=>{const r=await request(route);assert.deepEqual(r.items,[{dishId:dishes[0][1].id,dishName:'Pasta 1',unitsSold:9},{dishId:dishes[0][0].id,dishName:'Pasta 0',unitsSold:7}]);assert.deepEqual((await request(route+'&limit=1')).items,[r.items[0]]);});
});
