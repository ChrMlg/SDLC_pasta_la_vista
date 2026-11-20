import { invalid } from './business-error';

export const restaurantTimeZone = 'America/El_Salvador';

export function validateDate(value: unknown, field = 'date'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field, 'Fecha inválida');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 2000) invalid(field, 'Fecha inválida');
  return value;
}

export function timeMinutes(value: unknown, field = 'time'): number {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid(field, 'Hora inválida');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

// El Salvador utiliza UTC-06:00 sin cambio estacional para las fechas admitidas.
export function localInstant(date: string, time = '00:00'): Date {
  return new Date(`${validateDate(date)}T${time}:00-06:00`);
}

export function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: restaurantTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` };
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
