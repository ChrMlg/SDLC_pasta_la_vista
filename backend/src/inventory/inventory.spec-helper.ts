import { InventoryMovementsService } from './inventory-movements.service';
export const branchId='a1111111-1111-4111-8111-111111111111',itemId='b1111111-1111-4111-8111-111111111111';
export const session={userId:'u',role:'MANAGER' as const,branchId};
export const input={branchId,itemId,type:'OUT',quantity:1,reason:'Consumo'};
export function setup(stock=10,min=5,active:any=null){
 const tx:any={$queryRaw:jest.fn(),inventoryItem:{findFirst:jest.fn().mockResolvedValue({id:itemId,branchId,currentStock:stock,minStock:min}),update:jest.fn()},inventoryMovement:{create:jest.fn().mockResolvedValue({id:'movement'})},inventoryAlert:{findFirst:jest.fn().mockResolvedValue(active),create:jest.fn(),updateMany:jest.fn()}};
 const db={$transaction:async(fn:any)=>fn(tx)};return {tx,service:new InventoryMovementsService(db as any)};
}

export {InventoryMovementsService};
