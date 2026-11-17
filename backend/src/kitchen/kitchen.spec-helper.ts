export const branchId='a1111111-1111-4111-8111-111111111111',orderId='b1111111-1111-4111-8111-111111111111',itemId='c1111111-1111-4111-8111-111111111111';
export const kitchen={userId:'cook',role:'KITCHEN' as const,branchId};
export function fixture(status='PENDING'){
 const tx:any={$queryRaw:jest.fn(),order:{findUnique:jest.fn().mockResolvedValue({id:orderId,branchId,status,type:'DINE_IN',kitchenTicket:{status:'READY',branchId}}),update:jest.fn(),updateMany:jest.fn().mockResolvedValue({count:1})},kitchenTicket:{findUnique:jest.fn().mockResolvedValue({id:'ticket',branchId,status}),updateMany:jest.fn().mockResolvedValue({count:1}),update:jest.fn()},orderItem:{count:jest.fn().mockResolvedValue(0),updateMany:jest.fn().mockResolvedValue({count:1}),findFirst:jest.fn().mockResolvedValue({id:itemId,isReady:false,status:'IN_PREPARATION'})},kitchenTicketLog:{create:jest.fn().mockResolvedValue({id:'log'})}};
 const notifications={kitchenStatusCommitted:jest.fn(),orderDeliveryCommitted:jest.fn()};
 const db:any={$transaction:jest.fn(async(fn:any)=>fn(tx))};return {tx,db,notifications};
}
