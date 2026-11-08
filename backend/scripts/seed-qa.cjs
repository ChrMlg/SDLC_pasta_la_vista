const { PrismaClient } = require('@prisma/client');
const { randomBytes, randomUUID } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('../dist/auth/credentials');
const connection = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !['localhost','127.0.0.1','::1'].includes(connection.hostname) || !connection.pathname.endsWith('_test'))
  throw new Error('Este seed solo admite una base PostgreSQL local con nombre terminado en _test');
const db = new PrismaClient();
(async()=>{
  const password = process.env.QA_PASSWORD || randomBytes(24).toString('hex');
  if (password.length < 12) throw new Error('QA_PASSWORD debe tener al menos 12 caracteres');
  const branches = [];
  for (const [code,name] of [['QA-CEN','QA Centro'],['QA-BAM','QA Bambu']])
    branches.push(await db.branch.upsert({where:{code},create:{code,name},update:{}}));
  const variables = { baseUrl: process.env.QA_BASE_URL || 'http://localhost:3309/api', branchId:branches[0].id,otherBranchId:branches[1].id };
  for (const [label,role,branch] of [['customer','CUSTOMER',null],['otherCustomer','CUSTOMER',null],['manager','MANAGER',0],['waiter','WAITER',0],['kitchen','KITCHEN',0]]) {
    const email=`${label.toLowerCase()}@sdlc-qa.invalid`;
    await db.user.upsert({where:{email},create:{email,passwordHash:await hashPassword(password),role,branchId:branch===null?null:branches[branch].id,firstName:'Prueba',lastName:'Local',phone:'70000000'},update:{passwordHash:await hashPassword(password),isActive:true}});
    variables[label+'Email']=email; variables[label+'Password']=password;
  }
  const table=await db.table.upsert({where:{branchId_number:{branchId:branches[0].id,number:1}},create:{branchId:branches[0].id,number:1},update:{}});
  variables.tableId=table.id;
  const output=path.resolve(__dirname,'../../postman/.env.local');mkdirSync(path.dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify({id:randomUUID(),name:'SDLC QA privado',values:Object.entries(variables).map(([key,value])=>({key,value,enabled:true,type:key.endsWith('Password')?'secret':'default'})),_postman_variable_scope:'environment'},null,2),{mode:0o600});
  console.log('Fixtures QA listos. Entorno privado escrito en postman/.env.local (ignorado por Git).');
})().finally(()=>db.$disconnect()).catch(()=>{console.error('No se pudo preparar QA; revise la base local y las migraciones.');process.exitCode=1;});
