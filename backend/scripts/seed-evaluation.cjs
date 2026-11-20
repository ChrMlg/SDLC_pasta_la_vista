const fs=require('node:fs');
const path=require('node:path');
const {PrismaClient}=require('@prisma/client');
const {loadLocalConfig,root}=require('./local-stack.cjs');
const {loadProjectConfig}=require('./project-db-config.cjs');
async function main(){
  const remote=process.argv.includes('--configured');
  const config=remote?process.env:{...loadLocalConfig(),...loadProjectConfig('local')};
  if(!config.LOCAL_ACCESS_KEY||!config.DATABASE_URL)throw Error('Configurar LOCAL_ACCESS_KEY y DATABASE_URL; no se crea otra base');
  const db=new PrismaClient({datasources:{db:{url:config.DATABASE_URL}}});
  try {
    const customer=await require('../prisma/seed-evaluation.cjs').seedEvaluation(db,config.LOCAL_ACCESS_KEY,config.LOCAL_ACCESS_VERSION);
    const file=path.join(root,'ACCESO_CLIENTE_EVALUACION.md');
    fs.writeFileSync(file,`# Cliente de evaluación\n\nArchivo privado.\n\n- Correo: ${customer.email}\n- Contraseña: ${customer.password}\n`,{mode:0o600});fs.chmodSync(file,0o600);
    console.log('Semilla de personal, cliente, menú, reservas, inventario, pedidos, pagos, cocina, reseñas, lealtad y reportes preparada sin restablecer datos. Acceso privado: '+file);
  } finally {await db.$disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
