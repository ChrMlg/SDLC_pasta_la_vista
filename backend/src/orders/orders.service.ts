import { createHash, randomInt } from 'node:crypto';
import type { Session } from '../menu/menu.service';
import type { NotificationsService } from '../notifications/notifications.service';


export type OrderType = 'DINE_IN' | 'TAKEAWAY';
export type OrderInput = { branchId: string; type: OrderType; tableId: string | null; items: { dishId: string; quantity: number; note: string | null }[] };
export type CreatedOrder = { id: string; orderNumber: number; status: 'PENDING'; createdAt: Date; total: string; type: OrderType; branchId: string; tableId: string | null };
export type LinkPreview = { orderId: string; orderNumber: number; branchId: string; expiresAt: Date; usedAt: Date | null; clientId: string | null };
export interface OrdersRepository {
  branchExists(id: string): Promise<boolean>;
  create(input: OrderInput, userId: string, customer: boolean): Promise<CreatedOrder>;
  findLinkableOrder(id: string, branchId: string): Promise<{ id: string; clientId: string | null; type: OrderType } | null>;
  saveLinkCode(orderId: string, hash: string, expiresAt: Date): Promise<void>;
  previewCode(hash: string): Promise<LinkPreview | null>;
  confirmCode(hash: string, customerId: string): Promise<LinkPreview | 'conflict' | null>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
export class OrderError extends Error {
  status: number; code: string; field: string | null;
  constructor(status: number, code: string, message: string, field: string | null = null) { super(message); this.status = status; this.code = code; this.field = field; }
}
function fail(status: number, code: string, message: string, field: string | null = null): never {
  throw new OrderError(status, code, message, field);
}
function requireUuid(value: unknown, field: string) {
  if (typeof value !== 'string' || !uuid.test(value)) fail(422, 'INVALID_FIELD', `Identificador inválido: ${field}`, field);
}
function validateBody(body: unknown): OrderInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(422, 'INVALID_FIELD', 'Pedido inválido');
  const data = body as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!['branchId', 'type', 'tableId', 'items'].includes(key)) fail(422, 'INVALID_FIELD', `Campo no permitido: ${key}`, key);
  requireUuid(data.branchId, 'branchId');
  if (data.type !== 'DINE_IN' && data.type !== 'TAKEAWAY') fail(422, 'INVALID_FIELD', 'Tipo de pedido inválido', 'type');
  if (data.type === 'DINE_IN') requireUuid(data.tableId, 'tableId');
  if (data.type === 'TAKEAWAY' && data.tableId !== undefined && data.tableId !== null) fail(422, 'INVALID_FIELD', 'Para llevar no admite mesa', 'tableId');
  if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 100) fail(422, 'INVALID_FIELD', 'El pedido requiere entre 1 y 100 platillos', 'items');
  const items = data.items.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(422, 'INVALID_FIELD', 'Ítem inválido', `items.${index}`);
    const item = raw as Record<string, unknown>;
    for (const key of Object.keys(item)) if (!['dishId', 'quantity', 'note'].includes(key)) fail(422, 'INVALID_FIELD', `Campo no permitido: ${key}`, `items.${index}.${key}`);
    requireUuid(item.dishId, `items.${index}.dishId`);
    if (!Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 10000) fail(422, 'INVALID_FIELD', 'Cantidad inválida', `items.${index}.quantity`);
    if (item.note !== undefined && item.note !== null && (typeof item.note !== 'string' || item.note.length > 500)) fail(422, 'INVALID_FIELD', 'Nota inválida', `items.${index}.note`);
    return { dishId: item.dishId as string, quantity: item.quantity as number, note: (item.note as string | null | undefined) ?? null };
  });
  return { branchId: data.branchId as string, type: data.type, tableId: data.type === 'DINE_IN' ? data.tableId as string : null, items };
}

export class OrdersService {
  private repo: OrdersRepository;
  private readonly notifications?: Pick<NotificationsService, 'orderQueued'>;
  constructor(repo: OrdersRepository, notifications?: Pick<NotificationsService, 'orderQueued'>) { this.repo = repo; this.notifications = notifications; }
  async create(body: unknown, session: Session, customer: boolean) {
    if (session.role !== (customer ? 'CUSTOMER' : 'WAITER')) fail(403, 'FORBIDDEN', 'No tiene permiso para registrar este pedido');
    const input = validateBody(body);
    if (!customer && session.branchId !== input.branchId) fail(403, 'FORBIDDEN', 'Sucursal no autorizada');
    if (!(await this.repo.branchExists(input.branchId))) fail(404, 'NOT_FOUND', 'Sucursal no encontrada');
    try {
      const order = await this.repo.create(input, session.userId, customer);
      if (order.type === 'DINE_IN' && this.notifications) {
        try { await this.notifications.orderQueued(order.id); }
        catch (error) { console.error('Notification delivery failed after order commit', error); }
      }
      return { ...order, createdAt: order.createdAt.toISOString() };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') fail(409, 'ORDER_CONFLICT', 'El pedido cambió durante el registro');
      throw error;
    }
  }
  async createLinkCode(orderId: string, session: Session) {
    if (session.role !== 'WAITER') fail(403, 'FORBIDDEN', 'Solo un mesero puede generar códigos');
    requireUuid(orderId, 'orderId');
    const order = await this.repo.findLinkableOrder(orderId, session.branchId ?? '');
    if (!order) fail(404, 'NOT_FOUND', 'Pedido no encontrado');
    if (order.type !== 'DINE_IN' || order.clientId) fail(409, 'ORDER_NOT_LINKABLE', 'El pedido no admite vinculación');
    const code = Array.from({ length: 12 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join('');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    try { await this.repo.saveLinkCode(orderId, hashCode(code), expiresAt); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') fail(409, 'LINK_CODE_CONFLICT', 'El pedido cambió durante la vinculación'); throw error; }
    return { code, expiresAt: expiresAt.toISOString() };
  }
  async previewCode(code: string, session: Session) {
    if (session.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Solo un cliente puede vincular pedidos');
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) fail(404, 'NOT_FOUND', 'Código no encontrado');
    const preview = await this.repo.previewCode(hashCode(code));
    if (!preview || preview.usedAt || preview.expiresAt <= new Date() || preview.clientId) fail(404, 'NOT_FOUND', 'Código no encontrado');
    return { orderNumber: preview.orderNumber, branchId: preview.branchId, expiresAt: preview.expiresAt.toISOString() };
  }
  async confirmCode(body: unknown, session: Session) {
    if (session.role !== 'CUSTOMER') fail(403, 'FORBIDDEN', 'Solo un cliente puede vincular pedidos');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof (body as { code?: unknown }).code !== 'string') fail(422, 'INVALID_FIELD', 'Código inválido', 'code');
    const code = (body as { code: string }).code;
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) fail(422, 'INVALID_FIELD', 'Código inválido', 'code');
    let result: LinkPreview | 'conflict' | null;
    try { result = await this.repo.confirmCode(hashCode(code), session.userId); }
    catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') fail(409, 'LINK_CODE_CONFLICT', 'El código ya fue usado'); throw error; }
    if (!result) fail(404, 'NOT_FOUND', 'Código no encontrado');
    if (result === 'conflict') fail(409, 'LINK_CODE_CONFLICT', 'El código expiró o ya fue usado');
    return { orderId: result.orderId, orderNumber: result.orderNumber, branchId: result.branchId };
  }
}
