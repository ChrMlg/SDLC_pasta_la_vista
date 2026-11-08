export type PaymentDto = {
  cardHolder: string;
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cvv: string;
};

// Devuelve solamente los últimos cuatro dígitos; los datos de tarjeta no se persisten.
export function validatePayment(body: unknown, invalid: (field: string) => never): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('cardNumber');
  const input = body as Record<string, unknown>;
  const fields = ['cardHolder', 'cardNumber', 'expMonth', 'expYear', 'cvv'];
  for (const key of Object.keys(input)) if (!fields.includes(key)) invalid(key);
  if (typeof input.cardHolder !== 'string' || input.cardHolder.trim().length < 2 || input.cardHolder.trim().length > 80) invalid('cardHolder');
  if (typeof input.cardNumber !== 'string' || !/^\d{16}$/.test(input.cardNumber)) return invalid('cardNumber');
  const digits = [...input.cardNumber].map(Number);
  const checksum = digits.reduce((sum, digit, index) => {
    const value = index % 2 === 0 ? digit * 2 : digit;
    return sum + (value > 9 ? value - 9 : value);
  }, 0);
  if (checksum % 10 !== 0) invalid('cardNumber');
  if (!Number.isInteger(input.expMonth) || Number(input.expMonth) < 1 || Number(input.expMonth) > 12) invalid('expMonth');
  const now = new Date();
  if (!Number.isInteger(input.expYear) || Number(input.expYear) < now.getUTCFullYear() || Number(input.expYear) > 9999) invalid('expYear');
  if (Date.UTC(Number(input.expYear), Number(input.expMonth), 1) <= now.getTime()) invalid('expMonth');
  if (typeof input.cvv !== 'string' || !/^\d{3}$/.test(input.cvv)) invalid('cvv');
  return input.cardNumber.slice(-4);
}
