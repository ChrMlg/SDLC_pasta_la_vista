const { createHmac } = require('node:crypto');
const { branches } = require('./project-data.cjs');

function initialAccounts(key, version = '2') {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Ejecute npm start para preparar los accesos locales');
  // Compatibilidad: las cuentas ya creadas conservan sus identificadores y contraseñas.
  const legacy = version === '1';
  const digest = label => createHmac('sha256', key).update((legacy ? 'bistro-demo-v1:' : 'bistro-local-v2:') + label).digest('hex');
  const id = label => { const h=digest(label);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
  const users = [['waiter','WAITER',0],['kitchen','KITCHEN',0],['manager','MANAGER',0],['otherManager','MANAGER',1],['thirdManager','MANAGER',2],['general','GENERAL_MANAGER',null]].map(([label,role,branch]) => ({
    label, id:id('user-'+label), email:`${label.toLowerCase()}-${digest(label).slice(0,12)}@${legacy ? 'demo.bistro.local' : 'bistro.local'}`, password:digest('password-'+label).slice(0,40), role, branchId:branch===null?null:branches[branch].id,
  }));
  return { users, branches };
}
async function provisionInitialAccounts(db, key, version) {
  const data=initialAccounts(key, version), {hashPassword}=require('../dist/auth/credentials');
  const users=await Promise.all(data.users.map(async ({label,password,...user})=>({...user,passwordHash:await hashPassword(password)})));
  await db.user.createMany({data:users,skipDuplicates:true});
  // No se modifican contraseñas, roles ni perfiles existentes; los clientes usan registro público.
  return data;
}
module.exports={initialAccounts,provisionInitialAccounts};
