const { createHmac } = require('node:crypto');
const { branches } = require('./project-data.cjs');

function demoAccounts(seed) {
  if (typeof seed !== 'string' || !/^[a-f0-9]{64}$/.test(seed)) throw new Error('Configure LOCAL_DEMO_SEED con npm start');
  const digest = label => createHmac('sha256', seed).update('bistro-demo-v1:' + label).digest('hex');
  const id = label => { const h=digest(label);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
  const users = [['customer','CUSTOMER',null],['otherCustomer','CUSTOMER',null],['waiter','WAITER',0],['kitchen','KITCHEN',0],['manager','MANAGER',0],['otherManager','MANAGER',1],['general','GENERAL_MANAGER',null]].map(([label,role,branch]) => ({
    label, id:id('user-'+label), email:`${label.toLowerCase()}-${digest(label).slice(0,12)}@demo.bistro.local`, password:digest('password-'+label).slice(0,40), role, branchId:branch===null?null:branches[branch].id,
  }));
  return { users, branches, dish: { id:id('dish'), branchId:branches[0].id, name:`Pasta demostración ${digest('dish').slice(0,8)}`, category:'MAIN_COURSE', price:'10.00', createdById:users.find(user=>user.label==='manager').id } };
}
async function seedDemoAccounts(db, seed) {
  const data=demoAccounts(seed), {hashPassword,verifyPassword}=require('../dist/auth/credentials');
  const users=await Promise.all(data.users.map(async ({label,password,...user})=>({...user,passwordHash:await hashPassword(password)})));
  await db.$transaction(async tx=>{
    await tx.user.createMany({data:users,skipDuplicates:true});
    for(const account of data.users){const saved=await tx.user.findUnique({where:{id:account.id}});
      if(!saved || saved.email!==account.email || saved.role!==account.role || saved.branchId!==account.branchId || !await verifyPassword(account.password,saved.passwordHash || '')) throw new Error('La cuenta demo existente fue modificada; no se sobrescribe');
    }
    await tx.menuItem.upsert({where:{id:data.dish.id},create:{...data.dish,normalizedName:data.dish.name.toLowerCase()},update:{}});
  },{timeout:60000});
  return data;
}
module.exports={demoAccounts,seedDemoAccounts};
