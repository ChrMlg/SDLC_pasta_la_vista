import assert from 'node:assert/strict';
import { calculateTotals } from '../src/billing/billing-math.ts';

assert.deepEqual(calculateTotals(['0.01']), { subtotal: '0.01', discount: '0.00', tax: '0.00', total: '0.01' });
assert.deepEqual(calculateTotals(['0.04']), { subtotal: '0.04', discount: '0.00', tax: '0.01', total: '0.05' });
assert.deepEqual(calculateTotals(['10.00', '2.50'], '2.50'), { subtotal: '12.50', discount: '2.50', tax: '1.30', total: '11.30' });
assert.throws(() => calculateTotals(['1.00'], '1.00'));
console.log('Billing money rules passed');
