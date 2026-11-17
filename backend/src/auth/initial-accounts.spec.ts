const {initialAccounts}=require('../../prisma/initial-accounts.cjs');
describe('H1-H35. Credenciales iniciales por instalación',()=>{
 it('mantiene los accesos al reiniciar y los cambia entre instalaciones',()=>{const first=initialAccounts('a'.repeat(64),'2'),again=initialAccounts('a'.repeat(64),'2'),other=initialAccounts('b'.repeat(64),'2');expect(again).toEqual(first);expect(other.users.map((u:any)=>u.password)).not.toEqual(first.users.map((u:any)=>u.password));expect(new Set(first.users.map((u:any)=>u.email)).size).toBe(6);});
 it('no crea clientes por defecto ni permite una clave inválida',()=>{expect(initialAccounts('a'.repeat(64),'2').users.every((u:any)=>u.role!=='CUSTOMER')).toBe(true);for(const key of ['',undefined,'public'])expect(()=>initialAccounts(key)).toThrow();});
});
