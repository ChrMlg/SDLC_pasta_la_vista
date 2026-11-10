import { invalid } from '../common/business-error';
import { formatMinutes, localInstant, timeMinutes } from '../common/local-time';

export const reservationDurationMinutes = 90;

export function reservationEnd(date: string, time: string, openingTime: string, closingTime: string, now = new Date()): string {
  const minutes = timeMinutes(time);
  const opening = timeMinutes(openingTime);
  const closing = timeMinutes(closingTime);
  if (localInstant(date, time) <= now) invalid('date', 'La reservación debe ser futura');
  if (minutes < opening || minutes + reservationDurationMinutes > closing || (minutes - opening) % 60 !== 0)
    invalid('time', 'Seleccione un horario disponible dentro de la atención de la sucursal');
  return formatMinutes(minutes + reservationDurationMinutes);
}

// Los intervalos son semiabiertos: una reserva puede empezar cuando otra termina.
export function overlaps(startTime: string, endTime: string, otherStart: string, otherEnd: string): boolean {
  return startTime < otherEnd && endTime > otherStart;
}
