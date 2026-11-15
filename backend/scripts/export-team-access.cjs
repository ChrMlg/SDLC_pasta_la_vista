const fs = require('node:fs');
const path = require('node:path');
const { root, loadLocalConfig } = require('./local-stack.cjs');
const { initialAccounts } = require('../prisma/initial-accounts.cjs');

async function main() {
  const config = loadLocalConfig(), accounts = initialAccounts(config.LOCAL_ACCESS_KEY, config.LOCAL_ACCESS_VERSION);
  const baseUrl = `http://127.0.0.1:${config.API_PORT}/api`, verified = [];
  async function verify(label, email, password, expected) {
    const response = await fetch(baseUrl + '/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({email,password}), signal:AbortSignal.timeout(10000) });
    if (!response.ok) return false;
    const user = await response.json(), cookie = response.headers.get('set-cookie')?.split(';')[0];
    if (cookie) await fetch(baseUrl + '/auth/logout', {method:'POST',headers:{cookie}});
    if (expected && (user.role !== expected.role || user.branchId !== expected.branchId)) return false;
    if (!verified.some(row=>row.email===email)) verified.push({label,email,password,role:user.role,branchId:user.branchId});
    return true;
  }
  for (const account of accounts.users) {
    if (!await verify(account.label,account.email,account.password,account)) throw new Error('Una cuenta inicial fue modificada; se conserva y no se exportan credenciales incorrectas');
  }
  const now=new Date(),values={baseUrl,branchId:accounts.branches[0].id,otherBranchId:accounts.branches[1].id,branchIds:accounts.branches.slice(0,2).map(b=>b.id).join(','),
    from:new Date(now.getTime()-30*86400000).toISOString(),to:new Date(now.getTime()+86400000).toISOString(),limit:'10'};
  for (const account of accounts.users) { values[account.label+'Email']=account.email;values[account.label+'Password']=account.password; }
  const environment={name:'SDLC — Backend local',values:Object.entries(values).map(([key,value])=>({key,value,enabled:true,type:key.endsWith('Password')?'secret':'default'})),_postman_variable_scope:'environment'};
  const guide=fs.readFileSync(path.join(root,'USO_BACKEND.md'),'utf8');
  const text=guide+'\n## Accesos verificados de esta instalación\n\n'+
    '**Archivo privado: no publicar en GitHub.**\n\n'+
    `API: ${baseUrl}. Base persistente: ${config.POSTGRES_DB}.\n\n`+
    verified.map(account=>`### ${account.role} (${account.label})\n\n- Correo: \`${account.email}\`\n- Contraseña: \`${account.password}\`\n- Sucursal: \`${account.branchId || 'Sin sucursal fija'}\`\n`).join('\n');
  for(const [relative,content] of [['postman/SDLC.postman_environment.json',JSON.stringify(environment,null,2)+'\n'],['ACCESOS_LOCALES.md',text]]){
    const file=path.join(root,relative);fs.writeFileSync(file,content,{mode:0o600});fs.chmodSync(file,0o600);
  }
  fs.rmSync(path.join(root,'accesos-locales.txt'),{force:true});
  console.log('Accesos verificados y environment de Postman generado. No se modificaron cuentas ni contraseñas.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
