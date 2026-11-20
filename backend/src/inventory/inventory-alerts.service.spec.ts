import {setup,session,input,itemId,branchId} from './inventory.spec-helper';
describe('H15. Alertas de reabastecimiento',()=>{
 it('AC1: evalúa existencias resultantes del movimiento',async()=>{const {tx,service}=setup(6);await service.create(input,session);expect(tx.inventoryItem.update).toHaveBeenCalledWith({where:{id:itemId},data:{currentStock:5}});expect(tx.inventoryAlert.create).toHaveBeenCalled();});
 it('AC2: genera una alerta en el mínimo y no duplica una activa',async()=>{const {tx,service}=setup(6,5,{id:'existing'});await service.create(input,session);expect(tx.inventoryAlert.create).not.toHaveBeenCalled();});
 it('AC3: entrada superior al mínimo resuelve las activas',async()=>{const {tx,service}=setup(4);await service.create({...input,type:'IN',quantity:2},session);expect(tx.inventoryAlert.updateMany).toHaveBeenCalled();});
 it('AC4: no crea alerta por encima del mínimo',async()=>{const {tx,service}=setup(10);await service.create(input,session);expect(tx.inventoryAlert.create).not.toHaveBeenCalled();});
});
