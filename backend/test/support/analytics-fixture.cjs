const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../../dist/auth/credentials');

exports.analyticsFixture = async function(t, story) {
  const connection = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(connection.hostname));
  const db = new PrismaClient(), run = randomUUID(), branches = Array.from({length:4},()=>randomUUID()), users={}, cookies={}, dishes=[];
  const base=process.env.ANALYTICS_API_URL || `http://127.0.0.1:${3400+story}/api`;
  assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
  let server;
  t.after(async()=>{
    if(server && server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
    try {
      const branchId={in:branches};
      await db.payment.deleteMany({where:{bill:{branchId}}});
      await db.orderItem.deleteMany({where:{order:{branchId}}});
      await db.order.deleteMany({where:{branchId}});
      await db.bill.deleteMany({where:{branchId}});
      await db.menuItem.deleteMany({where:{branchId}});
      await db.user.deleteMany({where:{id:{in:Object.values(users).map(x=>x.id)}}});
      await db.branch.deleteMany({where:{id:branchId}});
    } finally { await db.$disconnect(); }
  });
  if(!process.env.ANALYTICS_API_URL)server=spawn(process.execPath,[path.join(__dirname,'../../dist/main.js')],{env:{...process.env,PORT:String(3400+story),NODE_ENV:'test'},stdio:'ignore'});
  let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(healthy);
  await db.branch.createMany({data:branches.map((id,i)=>({id,code:`H${story}-${run}-${i}`,name:`H${story} sucursal ${i}`}))});
  const password=randomBytes(24).toString('hex'),passwordHash=await hashPassword(password);
  for(const [key,role] of [['customer','CUSTOMER'],['waiter','WAITER'],['kitchen','KITCHEN'],['manager','MANAGER'],['general','GENERAL_MANAGER']]){
    users[key]=await db.user.create({data:{email:`${key}.${run}@analytics.invalid`,passwordHash,role,branchId:['CUSTOMER','GENERAL_MANAGER'].includes(role)?null:branches[0]}});
    const response=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:users[key].email,password})});assert.equal(response.status,200);cookies[key]=response.headers.get('set-cookie').split(';')[0];
  }
  for(const branchId of branches){const values=[];for(let i=0;i<2;i++)values.push(await db.menuItem.create({data:{branchId,name:`Pasta ${i}`,normalizedName:`pasta ${i}`,category:'MAIN_COURSE',price:'10',createdById:users.manager.id}}));dishes.push(values);}
  async function sale({branch=0,amount='10',status='PAID',billStatus='PAID',count=1,cancelled=false,createdAt='2035-01-02T12:00:00Z',orderAt=createdAt,quantities=[2,1]}={}){
    const bill=await db.bill.create({data:{branchId:branches[branch],type:'TAKEAWAY',clientId:users.customer.id,status:billStatus,subtotal:amount,tax:'0',total:amount}}),orders=[];
    for(let i=0;i<count;i++){
      const [{number}]=await db.$queryRaw`SELECT nextval('"OrderNumberSeq"')::integer AS number`;
      orders.push(await db.order.create({data:{orderNumber:number,branchId:branches[branch],createdById:users.customer.id,clientId:users.customer.id,type:'TAKEAWAY',status:cancelled?'CANCELLED':'DELIVERED',createdAt:new Date(orderAt),billId:bill.id,total:amount,items:{create:quantities.map((quantity,index)=>({dishId:dishes[branch][index].id,quantity,unitPrice:'10',status:'READY',isReady:true}))}}}));
    }
    const payment=await db.payment.create({data:{billId:bill.id,userId:users.customer.id,idempotencyKey:randomUUID(),status,amount,cardLast4:'4242',createdAt:new Date(createdAt)}});
    return {bill,orders,payment};
  }
  const period='from=2035-01-01T00%3A00%3A00Z&to=2035-01-31T23%3A59%3A59Z';
  async function request(route,expected=200,role='general'){
    const response=await fetch(base+route,{headers:role?{cookie:cookies[role]}:{},signal:AbortSignal.timeout(10000)}),body=await response.json();
    assert.equal(response.status,expected,JSON.stringify(body));if(expected>=400)assert.deepEqual(Object.keys(body).sort(),['code','field','message']);return body;
  }
  return {db,branches,users,cookies,dishes,sale,request,period};
};
