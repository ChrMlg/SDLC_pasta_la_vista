const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reviewConflict, REVIEW_WINDOW_MS } = require('../dist/reviews/review-rules');

const deliveredAt = new Date('2026-11-01T06:00:00.000Z');
const order = { status: 'DELIVERED', deliveredAt, review: null };
test('H23: exactly 720 UTC hours is eligible; one millisecond later is expired', () => {
  assert.equal(REVIEW_WINDOW_MS, 2592000000);
  assert.equal(reviewConflict(order, new Date(deliveredAt.getTime() + REVIEW_WINDOW_MS)), null);
  assert.equal(reviewConflict(order, new Date(deliveredAt.getTime() + REVIEW_WINDOW_MS + 1)).code, 'REVIEW_WINDOW_EXPIRED');
});
test('H23: equivalent UTC offsets have the same deadline', () => {
  assert.equal(reviewConflict({ ...order, deliveredAt: new Date('2026-11-01T00:00:00-06:00') }, new Date('2026-12-01T06:00:00Z')), null);
});
test('H23: missing, invalid or future delivery dates are not eligible', () => {
  for (const date of [null, new Date('invalid'), new Date(deliveredAt.getTime() + 1)])
    assert.equal(reviewConflict({ ...order, deliveredAt: date }, deliveredAt).code, 'INVALID_DELIVERY_DATE');
});
