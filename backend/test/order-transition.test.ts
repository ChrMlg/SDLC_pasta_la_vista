import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedPrevious } from '../src/orders/order-transition.ts';

test('kitchen may prepare and mark ready; waiter may deliver only orders out for delivery', () => {
  assert.equal(expectedPrevious('KITCHEN', 'IN_PREPARATION'), 'PENDING');
  assert.equal(expectedPrevious('KITCHEN', 'READY'), 'IN_PREPARATION');
  assert.equal(expectedPrevious('KITCHEN', 'DELIVERED'), null);
  assert.equal(expectedPrevious('WAITER', 'IN_PREPARATION'), null);
  assert.equal(expectedPrevious('WAITER', 'READY'), null);
  assert.equal(expectedPrevious('WAITER', 'DELIVERED'), 'OUT_FOR_DELIVERY');
});
