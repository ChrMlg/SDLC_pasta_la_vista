const { createHmac } = require('node:crypto');
const { initialAccounts, provisionInitialAccounts } = require('./initial-accounts.cjs');
const { id } = require('./project-data.cjs');

// Se usa el mismo script contra la base configurada en local y en despliegue.
async function seedEvaluation(db, key, version) {
  const accounts=initialAccounts(key,version);
  await require('./seed.cjs').seedLoyaltyRule(db);
  await db.loyaltyBenefit.upsert({
    where: { id: id('evaluation-loyalty-benefit') },
    create: { id: id('evaluation-loyalty-benefit'), name: 'Beneficio de evaluación', pointsRequired: 5, discountValue: '1.00', isActive: true },
    update: {},
  });
  await provisionInitialAccounts(db,key,version);
  const { hashPassword, verifyPassword }=require('../dist/auth/credentials');
  for(const account of accounts.users){
    const existing=await db.user.findUnique({where:{id:account.id}});
    if(!existing || !existing.isActive || existing.email!==account.email || existing.role!==account.role || existing.branchId!==account.branchId || !existing.passwordHash || !await verifyPassword(account.password,existing.passwordHash))throw Error('El personal inicial fue modificado; se conserva y la semilla se detiene');
  }
  const digest=createHmac('sha256',key).update('evaluation-customer-v1').digest('hex');
  const customer={id:id('evaluation-customer-'+digest.slice(0,12)),email:`cliente-${digest.slice(0,12)}@bistro.local`,password:digest.slice(0,40),role:'CUSTOMER'};
  await db.user.createMany({data:[{id:customer.id,email:customer.email,passwordHash:await hashPassword(customer.password),role:'CUSTOMER',firstName:'Cliente',lastName:'Evaluación',phone:'70000000'}],skipDuplicates:true});
  const saved=await db.user.findUnique({where:{id:customer.id}});
  if(!saved || saved.email!==customer.email || saved.role!=='CUSTOMER' || !saved.isActive || !saved.passwordHash || !await verifyPassword(customer.password,saved.passwordHash))throw Error('La cuenta de evaluación fue modificada; se conserva sin exportar credenciales incorrectas');
  for(const branch of accounts.branches){
    const manager=accounts.users.find(u=>u.role==='MANAGER'&&u.branchId===branch.id);
    await db.menuItem.createMany({data:[['Pasta de la casa','MAIN_COURSE','8.50'],['Limonada','DRINK','2.00']].map(([name,category,price])=>({id:id('evaluation-menu-'+branch.id+name),branchId:branch.id,name,normalizedName:name.toLowerCase(),category,price,isAvailable:true,createdById:manager.id})),skipDuplicates:true});
  }
  // Crear los ejemplos mediante los servicios conserva las reglas, recibos y notificaciones.
  const {OrdersService}=require('../dist/orders/orders.service');
  const {PrismaOrdersRepository}=require('../dist/orders/prisma-orders.repository');
  const {BillingService}=require('../dist/billing/billing.service');
  const {NotificationsService}=require('../dist/notifications/notifications.service');
  const {KitchenActionsService}=require('../dist/kitchen/kitchen-actions.service');
  const {KitchenReadyService}=require('../dist/kitchen/kitchen-ready.service');
  const {OrderDeliveryService}=require('../dist/orders/order-delivery.service');
  const {ReviewsService}=require('../dist/reviews/reviews.service');
  const notifications=new NotificationsService(db),orders=new OrdersService(new PrismaOrdersRepository(db));
  const billing=new BillingService(db,async()=>{},notifications);
  const session={userId:customer.id,role:'CUSTOMER',branchId:null};
  for (const [index,scenario] of [[0,'entregado'],[0,'pendiente'],[1,'pendiente'],[2,'pendiente'],[0,'saldo lealtad'],[0,'checkout lealtad']]) {
    const branch=accounts.branches[index],note='Evaluación inicial: '+scenario;
    let order=await db.order.findFirst({where:{branchId:branch.id,clientId:customer.id,items:{some:{note}}}});
    if(!order){
      const dish=await db.menuItem.findUnique({where:{branchId_normalizedName:{branchId:branch.id,normalizedName:'pasta de la casa'}}});
      const created=await orders.create({branchId:branch.id,type:'TAKEAWAY',items:[{dishId:dish.id,quantity:index+1,note}]},session,true);
      order=await db.order.findUnique({where:{id:created.id}});
    }
    // Si el equipo ya cambió este ejemplo, conservarlo en lugar de restablecerlo.
    if(order.status==='CANCELLED')continue;
    const bill=order.billId?await billing.getBill(order.billId,session):await billing.create(branch.id,{orderId:order.id},session);
    // Dejar una cuenta abierta para canjear puntos desde Swagger/Postman.
    if(scenario==='checkout lealtad')continue;
    if(bill.status!=='PAID')await billing.pay(bill.id,id('evaluation-payment-'+bill.id),{cardHolder:'Cliente Evaluación',cardNumber:'4242424242424242',expMonth:12,expYear:new Date().getFullYear()+2,cvv:'123'},session);
    if(index===0&&scenario==='entregado'){
      const cook=accounts.users.find(u=>u.label==='kitchen'),waiter=accounts.users.find(u=>u.label==='waiter');
      const cookSession={userId:cook.id,role:cook.role,branchId:branch.id},waiterSession={userId:waiter.id,role:waiter.role,branchId:branch.id};
      order=await db.order.findUnique({where:{id:order.id}});
      if(order.status==='PENDING')await new KitchenActionsService(db,notifications).change(branch.id,order.id,'TAKE',{},cookSession);
      order=await db.order.findUnique({where:{id:order.id}});
      if(order.status==='IN_PREPARATION')await new KitchenReadyService(db,notifications).mark(branch.id,order.id,null,{},cookSession);
      order=await db.order.findUnique({where:{id:order.id}});
      if(order.status==='READY')await new OrderDeliveryService(db,notifications).change(branch.id,order.id,'pickup',{},waiterSession);
      order=await db.order.findUnique({where:{id:order.id}});
      if(order.status==='OUT_FOR_DELIVERY')await new OrderDeliveryService(db,notifications).change(branch.id,order.id,'deliver',{},waiterSession);
      if(!await db.review.findUnique({where:{orderId:order.id}})) {
        const eligible=await new ReviewsService(db).eligibility(order.id,session);
        if(eligible.canReview)await new ReviewsService(db).create(order.id,{rating:5,comment:'Visita de evaluación del proyecto'},session);
      }
    }
  }
  const {InventoryMovementsService}=require('../dist/inventory/inventory-movements.service');
  const manager=accounts.users.find(u=>u.label==='manager'),branchId=accounts.branches[0].id;
  const inventoryId=id('evaluation-inventory');
  await db.inventoryItem.createMany({data:[{id:inventoryId,branchId,name:'Insumo de evaluación',unit:'unidad',minStock:5,currentStock:0}],skipDuplicates:true});
  const item=await db.inventoryItem.findUnique({where:{id:inventoryId}});
  if(!item)throw Error('Conflicto con insumo de evaluación; se conservan los datos existentes');
  const reason='Carga inicial para evaluación';
  if(item&&!await db.inventoryMovement.findFirst({where:{itemId:item.id,reason}}))await new InventoryMovementsService(db).create({branchId,itemId:item.id,type:'IN',quantity:1,reason},{userId:manager.id,role:manager.role,branchId});
  const {ReservationsService}=require('../dist/reservations/reservations.service');
  if(!await db.reservation.findFirst({where:{branchId,customerId:customer.id}})){
    const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    await new ReservationsService(db,notifications).create({branchId,date,time:'12:00',partySize:2},session);
  }
  return customer;
}
module.exports={seedEvaluation};
