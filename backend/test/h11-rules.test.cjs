const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertCancellationAllowed } = require('../dist/reservations/reservation-rules');
const { validateOccupancyQuery } = require('../dist/reservations/dto/occupancy-query.dto');

test('H11: cancellation includes the exact two-hour boundary in El Salvador', () => {
  const deadline = new Date('2030-01-02T16:00:00Z'); // Inicio 12:00 local = 18:00 UTC.
  assert.doesNotThrow(() => assertCancellationAllowed('2030-01-02', '12:00', 'CONFIRMED', deadline));
  assert.doesNotThrow(() => assertCancellationAllowed('2030-01-02', '12:00', 'PENDING', new Date(deadline.getTime() - 1)));
  for (const now of [new Date(deadline.getTime() + 1), new Date('2030-01-03T00:00:00Z')])
    assert.throws(() => assertCancellationAllowed('2030-01-02', '12:00', 'CONFIRMED', now), error => error.status === 400 && error.code === 'CANCELLATION_DEADLINE_PASSED');
});

test('H11: cancellation deadline crosses the local calendar day correctly', () => {
  assert.doesNotThrow(() => assertCancellationAllowed('2030-01-02', '01:00', 'CONFIRMED', new Date('2030-01-02T05:00:00Z')));
  assert.throws(() => assertCancellationAllowed('2030-01-02', '01:00', 'CONFIRMED', new Date('2030-01-02T05:00:01Z')), error => error.status === 400);
});

test('H11: rejects a second cancellation even before its deadline', () => {
  assert.throws(() => assertCancellationAllowed('2030-01-02', '12:00', 'CANCELLED', new Date('2030-01-01T00:00:00Z')),
    error => error.status === 400 && error.code === 'RESERVATION_ALREADY_CANCELLED');
});

test('H11: occupancy accepts historical dates and rejects invalid or extra filters', () => {
  assert.deepEqual(validateOccupancyQuery({ date: '2024-02-29' }), { date: '2024-02-29' });
  for (const query of [null, [], {}, { date: '2031-02-29' }, { date: ['2030-01-01'] }, { date: '2030-01-01', branchId: 'other' }])
    assert.throws(() => validateOccupancyQuery(query), error => error.status === 400);
});
