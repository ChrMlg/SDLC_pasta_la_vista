const { createHash } = require('node:crypto');

function id(label) {
  const value = createHash('sha256').update('sdlc-project-v1:' + label).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
// Se conservan las identidades y nombres que ya trae el backend compartido.
const branches = [
  { id: 'a1111111-1111-4111-8111-111111111111', code: 'CENTRO', name: 'Bistro Centro' },
  { id: 'a2222222-2222-4222-8222-222222222222', code: 'NORTE', name: 'Bistro Norte' },
  { id: 'a3333333-3333-4333-8333-333333333333', code: 'JARDIN', name: 'Bistro Jardín' },
];
const capacities = [[8,8,8,8,6,6,6,6,6,4,4,4], [8,8,8,6,6,6,6,4,4,4], [8,8,6,6,6,4,4,4]];
const tables = capacities.flatMap((values, branch) => values.map((capacity, position) => ({
  id: id(`table-${branch}-${position + 1}`), branchId: branches[branch].id, number: position + 1, capacity, status: 'AVAILABLE',
})));
// Datos ficticios persistentes para la demostración del proyecto; cantidades en la unidad indicada.
const catalog = [
  ['Arroz', 'g', 5000, [12500, 4000, 8000]], ['Harina', 'g', 5000, [7000, 9000, 3500]],
  ['Aceite', 'ml', 2000, [1500, 4000, 2500]], ['Sal', 'g', 500, [1000, 300, 800]],
  ['Tomate', 'unidad', 20, [30, 15, 25]],
];
const inventory = branches.flatMap((branch, i) => catalog.map(([name, unit, minStock, quantities]) => ({
  id: id(`item-${i}-${name}`), branchId: branch.id, name, unit, minStock, currentStock: quantities[i],
})));
const users = [
  ['customer', 'CUSTOMER', null, 'Ana', 'López'], ['otherCustomer', 'CUSTOMER', null, 'Luis', 'Pérez'],
  ['waiter', 'WAITER', 0, 'Carlos', 'Martínez'], ['kitchen', 'KITCHEN', 0, 'Sofía', 'García'],
  ['manager', 'MANAGER', 0, 'María', 'Torres'], ['otherManager', 'MANAGER', 1, 'José', 'Ramírez'],
  ['thirdManager', 'MANAGER', 2, 'Elena', 'Flores'], ['general', 'GENERAL_MANAGER', null, 'Daniel', 'Reyes'],
].map(([label, role, branch, firstName, lastName]) => ({ label, id: id('user-' + label),
  role, branchId: branch === null ? null : branches[branch].id, isActive: true, firstName, lastName }));
const reservations = [
  ['centro', 0, 'customer', '2030-01-15', '12:00', '13:30', 'CONFIRMED'],
  ['norte', 1, 'otherCustomer', '2030-01-15', '14:00', '15:30', 'CONFIRMED'],
  ['cancelada', 2, 'customer', '2030-01-16', '12:00', '13:30', 'CANCELLED'],
].map(([label, branchIndex, customer, date, startTime, endTime, status]) => ({ id: id('reservation-' + label), branchIndex,
  branchId: branches[branchIndex].id, customerId: id('user-' + customer), date, startTime, endTime, partySize: 4, status,
  createdAt: new Date('2026-11-10T12:00:00Z'), updatedAt: new Date('2026-11-10T12:00:00Z') }));

module.exports = { id, branches, tables, inventory, users, reservations };
