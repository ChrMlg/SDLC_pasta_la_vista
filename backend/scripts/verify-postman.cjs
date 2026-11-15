const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {PrismaClient}=require('@prisma/client');
const newman=require('newman');
const {loadProjectConfig,root}=require('./project-db-config.cjs');
const {hashPassword}=require('../dist/auth/credentials');
const {seedInventoryItems}=require('../prisma/seed-inventory.cjs');

async function main(){
  const config=loadProjectConfig('local'),url=new URL(config.DATABASE_URL),baseUrl=config.PROJECT_BASE_URL;
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Solo se verifica el backend local');
  const db=new PrismaClient({datasources:{db:{url:url.toString()}}}),branches=[randomUUID(),randomUUID()],userIds=[],roles={},run=randomUUID();
  let failure;
  try {
    await db.branch.createMany({data:branches.map((id,i)=>({id,code:`VERIFY-${run}-${i}`,name:`Verificación ${run} ${i}`}))});
    await db.table.create({data:{branchId:branches[0],number:1,capacity:4,status:'AVAILABLE'}});
    await seedInventoryItems(db,branches);
    for(const [label,role,index] of [['manager','MANAGER',0],['waiter','WAITER',0],['kitchen','KITCHEN',0],['general','GENERAL_MANAGER',null]]){
      const id=randomUUID(),email=`${label}-${run}@verify.local`,password=randomBytes(24).toString('hex');userIds.push(id);
      await db.user.create({data:{id,email,passwordHash:await hashPassword(password),role,branchId:index===null?null:branches[index]}});
      roles[label+'Email']=email;roles[label+'Password']=password;
    }
    const values={baseUrl,branchId:branches[0],otherBranchId:branches[1],branchIds:branches.join(','),...roles};
    const collection=JSON.parse(fs.readFileSync(path.join(root,'postman/SDLC-Backend.postman_collection.json'),'utf8'));
    const result=await new Promise((resolve,reject)=>{
      const runner=newman.run({collection,environment:{name:'Verificación aislada en la base local',values:Object.entries(values).map(([key,value])=>({key,value,enabled:true}))},reporters:[],timeoutRequest:15000},(error,summary)=>error?reject(error):resolve(summary));
      runner.on('request',(error,args)=>{
        if(!error && args.response.code===201 && args.request.url.toString().endsWith('/auth/register/customer')){
          const body=JSON.parse(args.response.stream.toString());if(body.role==='CUSTOMER' && typeof body.id==='string')userIds.push(body.id);
        }
      });
    });
    const report={requests:result.run.stats.requests,assertions:result.run.stats.assertions,failures:result.run.failures.map(item=>({request:item.source?.name,error:item.error?.message}))};
    console.log(JSON.stringify(report,null,2));
    if(result.run.failures.length)failure=new Error('Hay comprobaciones Postman fallidas');
  } catch(error){failure=error;}
  finally {
    try {
      // Cada eliminación está limitada a IDs generados por esta ejecución. Nunca se limpia una sucursal del equipo.
      const branchId={in:branches},userId={in:userIds},order={branchId};
      await db.notification.deleteMany({where:{userId}});
      await db.review.deleteMany({where:{branchId}});
      await db.kitchenTicketLog.deleteMany({where:{ticket:{order}}});
      await db.kitchenTicket.deleteMany({where:{order}});
      await db.orderLinkCode.deleteMany({where:{order}});
      await db.orderItem.deleteMany({where:{order}});
      await db.order.deleteMany({where:{branchId}});
      await db.receipt.deleteMany({where:{branchId}});
      await db.payment.deleteMany({where:{bill:{branchId}}});
      await db.bill.deleteMany({where:{branchId}});
      await db.receiptCounter.deleteMany({where:{branchId}});
      await db.reservation.deleteMany({where:{branchId}});
      await db.tableAssignment.deleteMany({where:{table:{branchId}}});
      await db.table.deleteMany({where:{branchId}});
      await db.inventoryAlert.deleteMany({where:{branchId}});
      await db.inventoryMovement.deleteMany({where:{item:{branchId}}});
      await db.inventoryItem.deleteMany({where:{branchId}});
      await db.menuAvailabilityChange.deleteMany({where:{menuItem:{branchId}}});
      await db.menuItem.deleteMany({where:{branchId}});
      await db.authSession.deleteMany({where:{userId}});
      await db.user.deleteMany({where:{id:userId}});
      await db.branch.deleteMany({where:{id:branchId}});
      console.log('Registros de verificación eliminados; datos del equipo conservados.');
    } finally {await db.$disconnect();}
  }
  if(failure)throw failure;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
