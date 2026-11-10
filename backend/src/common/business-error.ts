export class BusinessError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly field: string | null = null) { super(message); }
}

export function invalid(field: string, message = 'Valor inválido'): never {
  throw new BusinessError(400, 'INVALID_FIELD', message, field);
}

export function validateId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid(field, 'Identificador inválido');
}

export function inputFields(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('body', 'Solicitud inválida');
  const input = body as Record<string, unknown>;
  for (const field of Object.keys(input)) if (!allowed.includes(field)) invalid(field, 'Campo no permitido');
  return input;
}
