import { inputFields } from '../../common/business-error';
import { validateDate } from '../../common/local-time';

export function validateOccupancyQuery(query: unknown): { date: string } {
  const input = inputFields(query, ['date']);
  return { date: validateDate(input.date) };
}
