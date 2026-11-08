export const CATEGORIES = ['STARTER', 'MAIN_COURSE', 'DRINK', 'DESSERT'] as const;
export type MenuCategory = (typeof CATEGORIES)[number];
export type Role = 'CUSTOMER' | 'WAITER' | 'KITCHEN' | 'MANAGER' | 'GENERAL_MANAGER';
export type Session = { userId: string; role: Role; branchId: string | null };
export type MenuItem = {
  id: string; branchId: string; name: string; normalizedName: string;
  description: string | null; category: MenuCategory; price: string;
  isAvailable: boolean; createdAt: Date; updatedAt: Date; updatedById: string | null;
};
export type MenuInput = { name: string; description?: string | null; category: MenuCategory; price: string };
export type MenuFilters = { search?: string; category?: MenuCategory; isAvailable?: boolean; page: number };

export interface MenuRepository {
  branchExists(branchId: string): Promise<boolean>;
  find(branchId: string, id: string): Promise<MenuItem | null>;
  create(branchId: string, input: MenuInput & { normalizedName: string }, userId: string): Promise<MenuItem>;
  update(branchId: string, id: string, input: Partial<MenuInput> & { normalizedName?: string }, userId: string): Promise<MenuItem>;
  list(branchId: string, filters: MenuFilters): Promise<{ items: MenuItem[]; total: number }>;
  changeAvailability(branchId: string, id: string, isAvailable: boolean, userId: string): Promise<MenuItem | 'conflict' | null>;
}

export class MenuError extends Error {
  status: number;
  code: string;
  field: string | null;
  constructor(status: number, code: string, message: string, field: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

function fail(status: number, code: string, message: string, field: string | null = null): never {
  throw new MenuError(status, code, message, field);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const normalizeName = (name: string) => name.trim().replace(/\s+/gu, ' ').toLowerCase();

function validateId(value: string, field: string) {
  if (!uuid.test(value)) fail(400, 'INVALID_FIELD', `Identificador inválido: ${field}`, field);
}

function validateInput(body: unknown, partial: boolean): Partial<MenuInput> & { normalizedName?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_FIELD', 'Solicitud inválida');
  const input = body as Record<string, unknown>;
  const allowed = ['name', 'description', 'category', 'price'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(400, 'INVALID_FIELD', `Campo no permitido: ${key}`, key);
  if (partial && !Object.keys(input).length) fail(400, 'INVALID_FIELD', 'Debe indicar al menos un campo');
  if (!partial) for (const key of ['name', 'category', 'price']) {
    if (!(key in input)) fail(400, 'INVALID_FIELD', `Campo obligatorio: ${key}`, key);
  }
  const out: Partial<MenuInput> & { normalizedName?: string } = {};
  if ('name' in input) {
    if (typeof input.name !== 'string') fail(400, 'INVALID_FIELD', 'Nombre inválido', 'name');
    const name = input.name.trim().replace(/\s+/gu, ' ');
    if (name.length < 2 || name.length > 80) fail(400, 'INVALID_FIELD', 'El nombre debe tener entre 2 y 80 caracteres', 'name');
    out.name = name;
    out.normalizedName = normalizeName(name);
  }
  if ('description' in input) {
    if (input.description !== null && typeof input.description !== 'string') fail(400, 'INVALID_FIELD', 'Descripción inválida', 'description');
    if (typeof input.description === 'string' && input.description.length > 300) fail(400, 'INVALID_FIELD', 'La descripción excede 300 caracteres', 'description');
    out.description = input.description as string | null;
  }
  if ('category' in input) {
    if (!CATEGORIES.includes(input.category as MenuCategory)) fail(400, 'INVALID_FIELD', 'Categoría inválida', 'category');
    out.category = input.category as MenuCategory;
  }
  if ('price' in input) {
    if (typeof input.price !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(input.price)) fail(400, 'INVALID_FIELD', 'Precio inválido', 'price');
    const [whole, fraction = ''] = input.price.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents < 1 || cents > 9999999) fail(400, 'INVALID_FIELD', 'Precio fuera de rango', 'price');
    out.price = `${whole}.${fraction.padEnd(2, '0')}`;
  }
  return out;
}

function validateFilters(query: Record<string, unknown>, administrative: boolean): MenuFilters {
  const allowed = administrative ? ['search', 'category', 'isAvailable', 'page'] : ['search', 'category', 'page'];
  for (const key of Object.keys(query)) if (!allowed.includes(key)) fail(400, 'INVALID_FIELD', `Filtro no permitido: ${key}`, key);
  const filters: MenuFilters = { page: 1 };
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 80) fail(400, 'INVALID_FIELD', 'Búsqueda inválida', 'search');
    filters.search = query.search;
  }
  if (query.category !== undefined) {
    if (!CATEGORIES.includes(query.category as MenuCategory)) fail(400, 'INVALID_FIELD', 'Categoría inválida', 'category');
    filters.category = query.category as MenuCategory;
  }
  if (query.isAvailable !== undefined) {
    if (query.isAvailable !== 'true' && query.isAvailable !== 'false') fail(400, 'INVALID_FIELD', 'Disponibilidad inválida', 'isAvailable');
    filters.isAvailable = query.isAvailable === 'true';
  }
  if (query.page !== undefined) {
    if (typeof query.page !== 'string' || !/^[1-9]\d*$/.test(query.page) || !Number.isSafeInteger(Number(query.page))) fail(400, 'INVALID_FIELD', 'Página inválida', 'page');
    filters.page = Number(query.page);
  }
  return filters;
}

export function itemResponse(item: MenuItem) {
  return {
    id: item.id, branchId: item.branchId, name: item.name, description: item.description,
    category: item.category, price: item.price, isAvailable: item.isAvailable,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(),
  };
}

export class MenuService {
  private repo: MenuRepository;
  constructor(repo: MenuRepository) { this.repo = repo; }

  private async authorize(branchId: string, session: Session, administrative: boolean) {
    validateId(branchId, 'branchId');
    const allowed = administrative ? ['MANAGER', 'GENERAL_MANAGER'] : ['CUSTOMER', 'WAITER', 'MANAGER', 'GENERAL_MANAGER'];
    if (!allowed.includes(session.role)) fail(403, 'FORBIDDEN', 'No tiene permiso para administrar este menú');
    if (session.role !== 'CUSTOMER' && session.role !== 'GENERAL_MANAGER' && session.branchId !== branchId)
      fail(404, 'NOT_FOUND', 'Sucursal no encontrada');
    if (!(await this.repo.branchExists(branchId))) fail(404, 'NOT_FOUND', 'Sucursal no encontrada');
  }

  async create(branchId: string, session: Session, body: unknown) {
    await this.authorize(branchId, session, true);
    const input = validateInput(body, false) as MenuInput & { normalizedName: string };
    try { return itemResponse(await this.repo.create(branchId, input, session.userId)); }
    catch (error) { this.handleWriteError(error); }
  }

  async update(branchId: string, id: string, session: Session, body: unknown) {
    await this.authorize(branchId, session, true);
    validateId(id, 'menuItemId');
    const input = validateInput(body, true);
    if (!(await this.repo.find(branchId, id))) fail(404, 'NOT_FOUND', 'Platillo no encontrado');
    try { return itemResponse(await this.repo.update(branchId, id, input, session.userId)); }
    catch (error) { this.handleWriteError(error); }
  }

  async get(branchId: string, id: string, session: Session) {
    await this.authorize(branchId, session, true);
    validateId(id, 'menuItemId');
    const item = await this.repo.find(branchId, id);
    if (!item) fail(404, 'NOT_FOUND', 'Platillo no encontrado');
    return itemResponse(item);
  }

  async list(branchId: string, session: Session, query: Record<string, unknown>, administrative: boolean) {
    await this.authorize(branchId, session, administrative);
    const filters = validateFilters(query, administrative);
    const { items, total } = await this.repo.list(branchId, filters);
    const data = items.map(itemResponse);
    if (!administrative) return {
      data: data.map(({ id, name, description, category, price, isAvailable }) => ({ id, name, description, category, price, isAvailable })),
      total, page: filters.page, pageSize: 10,
    };
    return { data, total, page: filters.page, pageSize: 10 };
  }

  async availability(branchId: string, id: string, session: Session, body: unknown) {
    await this.authorize(branchId, session, true);
    validateId(id, 'menuItemId');
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof (body as { isAvailable?: unknown }).isAvailable !== 'boolean')
      fail(400, 'INVALID_FIELD', 'Disponibilidad inválida', 'isAvailable');
    const desired = (body as { isAvailable: boolean }).isAvailable;
    const result = await this.repo.changeAvailability(branchId, id, desired, session.userId);
    if (result === null) fail(404, 'NOT_FOUND', 'Platillo no encontrado');
    if (result === 'conflict') fail(409, 'AVAILABILITY_CONFLICT', 'El platillo ya tiene ese estado');
    return { id: result.id, branchId: result.branchId, isAvailable: result.isAvailable,
      updatedAt: result.updatedAt.toISOString(), updatedById: result.updatedById };
  }

  private handleWriteError(error: unknown): never {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
      fail(409, 'DUPLICATE_MENU_ITEM', 'Ya existe un platillo con ese nombre en esta sucursal');
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025')
      fail(404, 'NOT_FOUND', 'Platillo no encontrado');
    throw error;
  }
}
