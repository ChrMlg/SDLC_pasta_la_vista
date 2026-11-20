const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomBytes}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {initialAccounts,provisionInitialAccounts}=require('../prisma/initial-accounts.cjs');
test('initial staff accounts preserve existing credentials and do not create customers or menu data',async t=>{
 assert.equal(process.env.ALLOW_LOCAL_FIXTURES,'1');
 const db=new PrismaClient(),key=randomBytes(32).toString('hex'),data=initialAccounts(key);
 t.after(async()=>{await db.user.deleteMany({where:{id:{in:data.users.map(u=>u.id)}}});await db.$disconnect();});
 const customerCount=await db.user.count({where:{role:'CUSTOMER'}}),dishCount=await db.menuItem.count();
 await provisionInitialAccounts(db,key,'2');
 assert.equal(await db.user.count({where:{id:{in:data.users.map(u=>u.id)}}}),6);
 const first=data.users[0];await db.user.update({where:{id:first.id},data:{passwordHash:'changed-by-owner'}});
 const before=await db.user.findMany({where:{id:{in:data.users.map(u=>u.id)}},orderBy:{id:'asc'}});
 await provisionInitialAccounts(db,key,'2');
 assert.deepEqual(await db.user.findMany({where:{id:{in:data.users.map(u=>u.id)}},orderBy:{id:'asc'}}),before);
 assert.equal(await db.user.count({where:{role:'CUSTOMER'}}),customerCount);assert.equal(await db.menuItem.count(),dishCount);
});
