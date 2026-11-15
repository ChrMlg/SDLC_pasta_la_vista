const fs=require('node:fs');
const path=require('node:path');
const {demoAccounts}=require('../prisma/demo-accounts.cjs');
function exportDemoAccess(root,config){
  const data=demoAccounts(config.LOCAL_DEMO_SEED), now=new Date();
  const variables={baseUrl:`http://127.0.0.1:${config.API_PORT}/api`,branchId:data.branches[0].id,otherBranchId:data.branches[1].id,
    branchIds:data.branches.slice(0,2).map(b=>b.id).join(','),dishId:data.dish.id,rating:'5',limit:'10',
    from:new Date(now.getTime()-30*86400000).toISOString(),to:new Date(now.getTime()+86400000).toISOString(),dateFrom:new Date(now.getTime()-30*86400000).toISOString().slice(0,10),dateTo:new Date(now.getTime()+86400000).toISOString().slice(0,10)};
  for(const user of data.users){variables[user.label+'Email']=user.email;variables[user.label+'Password']=user.password;}
  const files=[['postman/.env.demo.local',JSON.stringify({name:'Demostración local',values:Object.entries(variables).map(([key,value])=>({key,value,enabled:true,type:key.endsWith('Password')?'secret':'default'})),_postman_variable_scope:'environment'},null,2)+'\n'],
    ['accesos-demo-local.txt',`Accesos de demostración local. No subir este archivo al repositorio.\nBackend: ${variables.baseUrl}\nImportar postman/Local-Demo.postman_collection.json y postman/.env.demo.local en Postman.\nSeleccionar el environment y ejecutar en orden. La colección crea un pedido, pago simulado y reseña de demostración.\nSe conservan las cuentas y datos anteriores. Estas credenciales son propias de esta computadora.\n\n`+data.users.map(u=>`${u.role} (${u.label})\nCorreo: ${u.email}\nContraseña: ${u.password}\nSucursal: ${u.branchId || 'No asignada'}\n`).join('\n')]];
  for(const [name,text] of files){const file=path.join(root,name);fs.writeFileSync(file,text,{mode:0o600});fs.chmodSync(file,0o600);}
}
module.exports={exportDemoAccess};
