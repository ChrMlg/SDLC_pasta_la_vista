import { inputFields, invalid, validateId } from '../../common/business-error';
import { timeMinutes, validateDate } from '../../common/local-time';

export type ReservationDto = { branchId: string; date: string; time: string; partySize: number };

export function validateReservation(body: unknown): ReservationDto {
  const input = inputFields(body, ['branchId', 'date', 'time', 'partySize']);
  validateId(input.branchId, 'branchId');
  const date = validateDate(input.date);
  timeMinutes(input.time);
  if (typeof input.partySize !== 'number' || !Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 2147483647)
    invalid('partySize', 'Indique una cantidad entera de personas mayor a cero');
  return { branchId: input.branchId, date, time: input.time as string, partySize: input.partySize };
}
