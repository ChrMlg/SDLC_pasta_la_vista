const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const domain=process.argv[2];
if(!domain||! /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)){
 console.error('Indique el dominio real de la API, sin protocolo ni ruta.');process.exit(1);
}
const target=path.join(root,'deploy/digitalocean/.env.production');
try {
 fs.writeFileSync(target,`API_DOMAIN=${domain.toLowerCase()}\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nLOCAL_ACCESS_KEY=${randomBytes(32).toString('hex')}\nCORS_ORIGINS=\n`,{mode:0o600,flag:'wx'});
 console.log('Configuración privada creada. Complete CORS_ORIGINS cuando el equipo defina la URL del frontend. No reemplazar este archivo si ya hay un volumen de producción.');
} catch(error){if(error.code==='EEXIST'){console.error('Ya existe configuración privada; se conserva sin cambiar las credenciales.');process.exitCode=1;}else throw error;}
