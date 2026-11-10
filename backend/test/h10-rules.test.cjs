const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateReservation } = require('../dist/reservations/dto/reservation.dto');
const { reservationEnd, overlaps } = require('../dist/reservations/reservation-rules');
const { localInstant, localParts } = require('../dist/common/local-time');

test('H10: rejects malformed dates, times, quantities and client-selected identity', () => {
  const input = { branchId: 'a1111111-1111-4111-8111-111111111111', date: '2032-02-29', time: '12:00', partySize: 2 };
  assert.deepEqual(validateReservation(input), input);
  for (const changes of [
    { date: '2031-02-29' }, { date: '2032-02-30' }, { date: '2032-13-01' }, { date: '2032-1-01' },
    { time: '24:00' }, { time: '12:60' }, { time: '12:00:00' },
    { partySize: 0 }, { partySize: -1 }, { partySize: 1.5 }, { partySize: '2' }, { partySize: 2147483648 },
    { branchId: 'invalid' }, { customerId: input.branchId }, { tableId: input.branchId }, { status: 'PENDING' },
  ]) assert.throws(() => validateReservation({ ...input, ...changes }), error => error.status === 400);
  for (const body of [null, [], 'invalid', {}]) assert.throws(() => validateReservation(body), error => error.status === 400);
});

test('H10: enforces 90 minutes, hourly starts and full duration before closing', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  assert.equal(reservationEnd('2030-01-02', '12:00', '12:00', '22:00', now), '13:30');
  assert.equal(reservationEnd('2030-01-02', '20:00', '12:00', '22:00', now), '21:30');
  assert.equal(reservationEnd('2030-01-02', '12:30', '12:30', '22:00', now), '14:00');
  for (const time of ['11:00', '12:30', '21:00', '22:00'])
    assert.throws(() => reservationEnd('2030-01-02', time, '12:00', '22:00', now), error => error.status === 400 && error.field === 'time');
});

test('H10: compares the exact start instant in El Salvador time', () => {
  const start = localInstant('2030-01-02', '12:00');
  assert.equal(start.toISOString(), '2030-01-02T18:00:00.000Z');
  assert.deepEqual(localParts(new Date('2030-01-02T04:00:00Z')), { date: '2030-01-01', time: '22:00' });
  assert.throws(() => reservationEnd('2030-01-02', '12:00', '12:00', '22:00', start), error => error.field === 'date');
  assert.equal(reservationEnd('2030-01-02', '12:00', '12:00', '22:00', new Date(start.getTime() - 1)), '13:30');
});

test('H10: adjacent intervals do not overlap; partial and contained intervals do', () => {
  assert.equal(overlaps('12:00', '13:30', '13:30', '15:00'), false);
  assert.equal(overlaps('13:30', '15:00', '12:00', '13:30'), false);
  assert.equal(overlaps('12:00', '13:30', '13:00', '14:30'), true);
  assert.equal(overlaps('12:00', '13:30', '11:30', '13:00'), true);
  assert.equal(overlaps('12:00', '13:30', '12:00', '13:30'), true);
});
