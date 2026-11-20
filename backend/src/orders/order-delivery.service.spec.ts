import { OrderDeliveryService } from './order-delivery.service';
import {fixture,branchId,orderId} from '../kitchen/kitchen.spec-helper';
const waiter={userId:'waiter',role:'WAITER' as const,branchId};
function setup(status='READY'){const f=fixture(status);return {...f,service:new OrderDeliveryService(f.db,f.notifications as any)};}
describe('H9. Recogida y confirmación de entrega',()=>{
 it('AC1: recoge READY con usuario y fecha',async()=>{const {service,tx}=setup();await service.change(branchId,orderId,'pickup',{},waiter);expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({status:'OUT_FOR_DELIVERY',pickedUpById:'waiter',pickedUpAt:expect.any(Date)});});
 it('AC2: entrega OUT_FOR_DELIVERY con fecha para reseñas',async()=>{const {service,tx}=setup('OUT_FOR_DELIVERY');await service.change(branchId,orderId,'deliver',{},waiter);expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({status:'DELIVERED',deliveredById:'waiter',deliveredAt:expect.any(Date)});});
 it('AC3: solo mesero puede ejecutar',async()=>{await expect(setup().service.change(branchId,orderId,'pickup',{}, {...waiter,role:'KITCHEN'})).rejects.toMatchObject({status:403});});
 it('AC4: transición inválida o actualización concurrente perdida devuelve 409',async()=>{await expect(setup('PENDING').service.change(branchId,orderId,'pickup',{},waiter)).rejects.toMatchObject({status:409});const {service,tx}=setup();tx.order.updateMany.mockResolvedValue({count:0});await expect(service.change(branchId,orderId,'pickup',{},waiter)).rejects.toMatchObject({status:409});});
 it('AC5: sucursal ajena 403 y pedido inexistente 404',async()=>{await expect(setup().service.change(branchId,orderId,'pickup',{}, {...waiter,branchId:'other'})).rejects.toMatchObject({status:403});const {service,tx}=setup();tx.order.findUnique.mockResolvedValue(null);await expect(service.change(branchId,orderId,'pickup',{},waiter)).rejects.toMatchObject({status:404});});
 it('AC6: notifica cada transición confirmada',async()=>{for(const [action,status,next] of [['pickup','READY','OUT_FOR_DELIVERY'],['deliver','OUT_FOR_DELIVERY','DELIVERED']] as const){const {service,notifications}=setup(status);await service.change(branchId,orderId,action,{},waiter);expect(notifications.orderDeliveryCommitted).toHaveBeenCalledWith(orderId,next);}});
 it('AC7: no modifica comanda y no requiere escribir la cuenta',async()=>{const {service,tx}=setup();await service.change(branchId,orderId,'pickup',{},waiter);expect(tx.kitchenTicket.update).not.toHaveBeenCalled();expect(tx.kitchenTicket.updateMany).not.toHaveBeenCalled();});
});
