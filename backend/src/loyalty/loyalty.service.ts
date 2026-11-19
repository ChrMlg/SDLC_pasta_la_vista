import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Session } from '../menu/menu.service';
import { BusinessError, inputFields, validateId } from '../common/business-error';

type DecimalInput = string | number;
const ruleId = 'GLOBAL';

function decimalText(value: unknown, field: string, scale: number): string {
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new BusinessError(400, 'INVALID_FIELD', 'Valor decimal inválido', field);
  const text = String(value);
  const pattern = scale === 4 ? /^(?:0|[1-9]\d{0,5})(?:\.\d{1,4})?$/ : /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
  if (!pattern.test(text) || /^0+(?:\.0+)?$/.test(text))
    throw new BusinessError(400, 'INVALID_FIELD', 'El valor debe ser mayor que cero y respetar la precisión permitida', field);
  return text;
}

function serializeRule(rule: { conversionRate: { toFixed: (scale: number) => string }; updatedById: string; updatedAt: Date }) {
  return { conversionRate: Number(rule.conversionRate.toFixed(4)), updatedById: rule.updatedById, updatedAt: rule.updatedAt.toISOString() };
}

function serializeBenefit(benefit: { id: string; name: string; pointsRequired: number; discountValue: { toFixed: (scale: number) => string }; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: benefit.id, name: benefit.name, pointsRequired: benefit.pointsRequired, discountValue: Number(benefit.discountValue.toFixed(2)), isActive: benefit.isActive, createdAt: benefit.createdAt.toISOString(), updatedAt: benefit.updatedAt.toISOString() };
}

@Injectable()
export class LoyaltyService {
  constructor(private readonly db: PrismaClient) {}

  getRule(session: Session) {
    this.requireReadRole(session);
    return this.db.loyaltyRule.findUnique({ where: { id: ruleId } }).then(rule => {
      if (!rule) throw new BusinessError(404, 'LOYALTY_RULE_NOT_FOUND', 'No hay una regla de lealtad configurada');
      return serializeRule(rule);
    });
  }

  async updateRule(body: unknown, session: Session) {
    this.requireWriteRole(session);
    const input = inputFields(body, ['conversionRate']);
    if (Object.keys(input).length !== 1) throw new BusinessError(400, 'INVALID_FIELD', 'Debe indicar conversionRate', 'conversionRate');
    const conversionRate = decimalText(input.conversionRate as DecimalInput, 'conversionRate', 4);
    const rule = await this.db.loyaltyRule.upsert({
      where: { id: ruleId },
      create: { id: ruleId, conversionRate, updatedById: session.userId },
      update: { conversionRate, updatedById: session.userId },
    });
    return serializeRule(rule);
  }

  async listAllBenefits(session: Session) {
    this.requireReadRole(session);
    const benefits = await this.db.loyaltyBenefit.findMany({ orderBy: [{ pointsRequired: 'asc' }, { id: 'asc' }] });
    return benefits.map(serializeBenefit);
  }

  async listActiveBenefits(session: Session) {
    if (session.role !== 'CUSTOMER') throw new BusinessError(403, 'FORBIDDEN', 'Solo clientes pueden consultar beneficios de checkout');
    const benefits = await this.db.loyaltyBenefit.findMany({ where: { isActive: true }, orderBy: [{ pointsRequired: 'asc' }, { id: 'asc' }] });
    return benefits.map(serializeBenefit);
  }

  async createBenefit(body: unknown, session: Session) {
    this.requireWriteRole(session);
    const input = inputFields(body, ['name', 'pointsRequired', 'discountValue', 'isActive']);
    const name = this.name(input.name);
    const pointsRequired = this.points(input.pointsRequired);
    const discountValue = decimalText(input.discountValue, 'discountValue', 2);
    if (typeof input.isActive !== 'boolean') throw new BusinessError(400, 'INVALID_FIELD', 'isActive debe ser booleano', 'isActive');
    const benefit = await this.db.loyaltyBenefit.create({ data: { name, pointsRequired, discountValue, isActive: input.isActive } });
    return serializeBenefit(benefit);
  }

  async updateBenefit(id: string, body: unknown, session: Session) {
    this.requireWriteRole(session);
    validateId(id, 'benefitId');
    const input = inputFields(body, ['name', 'pointsRequired', 'discountValue', 'isActive']);
    if (!Object.keys(input).length) throw new BusinessError(400, 'INVALID_FIELD', 'Indique al menos un campo');
    const data: { name?: string; pointsRequired?: number; discountValue?: string; isActive?: boolean } = {};
    if ('name' in input) data.name = this.name(input.name);
    if ('pointsRequired' in input) data.pointsRequired = this.points(input.pointsRequired);
    if ('discountValue' in input) data.discountValue = decimalText(input.discountValue, 'discountValue', 2);
    if ('isActive' in input) {
      if (typeof input.isActive !== 'boolean') throw new BusinessError(400, 'INVALID_FIELD', 'isActive debe ser booleano', 'isActive');
      data.isActive = input.isActive;
    }
    const result = await this.db.loyaltyBenefit.updateMany({ where: { id }, data });
    if (!result.count) throw new BusinessError(404, 'BENEFIT_NOT_FOUND', 'Beneficio no encontrado');
    const benefit = await this.db.loyaltyBenefit.findUniqueOrThrow({ where: { id } });
    return serializeBenefit(benefit);
  }

  private requireReadRole(session: Session) {
    if (session.role !== 'MANAGER' && session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia puede consultar la configuración de lealtad');
  }

  private requireWriteRole(session: Session) {
    if (session.role !== 'GENERAL_MANAGER')
      throw new BusinessError(403, 'FORBIDDEN', 'Solo gerencia general puede modificar la configuración de lealtad');
  }

  private name(value: unknown) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 100 || value.trim() !== value || !value.trim())
      throw new BusinessError(400, 'INVALID_FIELD', 'name debe tener entre 1 y 100 caracteres sin espacios externos', 'name');
    return value;
  }

  private points(value: unknown) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647)
      throw new BusinessError(400, 'INVALID_FIELD', 'pointsRequired debe ser un entero positivo', 'pointsRequired');
    return value;
  }
}
