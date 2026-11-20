import assert from 'node:assert/strict';
import { MenuService, MenuError, normalizeName, type MenuRepository, type MenuItem, type MenuInput, type MenuFilters, type Session } from './menu.service';

export const branchA = '11111111-1111-4111-8111-111111111111';
export const branchB = '22222222-2222-4222-8222-222222222222';
export const manager: Session = { userId: '33333333-3333-4333-8333-333333333333', role: 'MANAGER', branchId: branchA };
export const customer: Session = { userId: '44444444-4444-4444-8444-444444444444', role: 'CUSTOMER', branchId: null };
export const baseInput = { name: 'Pollo asado', category: 'MAIN_COURSE', price: '12.50' } as const;

export class FakeRepo implements MenuRepository {
  items: MenuItem[] = [];
  changes: { id: string; oldValue: boolean; newValue: boolean; userId: string }[] = [];
  async branchExists(id: string) { return id === branchA || id === branchB; }
  async find(branchId: string, id: string) { return this.items.find(item => item.branchId === branchId && item.id === id) ?? null; }
  async create(branchId: string, input: MenuInput & { normalizedName: string }, _userId: string) {
    if (this.items.some(item => item.branchId === branchId && item.normalizedName === input.normalizedName)) throw { code: 'P2002' };
    const now = new Date();
    const item: MenuItem = { ...input, id: `55555555-5555-4555-8555-${String(this.items.length + 1).padStart(12, '0')}`,
      branchId, description: input.description ?? null, isAvailable: true, createdAt: now, updatedAt: now, updatedById: null };
    this.items.push(item); return item;
  }
  async update(branchId: string, id: string, input: Partial<MenuInput> & { normalizedName?: string }, userId: string) {
    const item = await this.find(branchId, id);
    if (!item) throw { code: 'P2025' };
    if (input.normalizedName && this.items.some(other => other !== item && other.branchId === branchId && other.normalizedName === input.normalizedName)) throw { code: 'P2002' };
    Object.assign(item, input, { updatedById: userId, updatedAt: new Date() }); return item;
  }
  async list(branchId: string, filters: MenuFilters) {
    const items = this.items.filter(item => item.branchId === branchId &&
      (filters.category === undefined || item.category === filters.category) &&
      (filters.isAvailable === undefined || item.isAvailable === filters.isAvailable) &&
      (filters.search === undefined || item.name.toLowerCase().includes(filters.search.toLowerCase())));
    items.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { items: items.slice((filters.page - 1) * 10, filters.page * 10), total: items.length };
  }
  async changeAvailability(branchId: string, id: string, desired: boolean, userId: string) {
    const item = await this.find(branchId, id);
    if (!item) return null;
    if (item.isAvailable === desired) return 'conflict' as const;
    this.changes.push({ id, oldValue: item.isAvailable, newValue: desired, userId });
    item.isAvailable = desired; item.updatedById = userId; item.updatedAt = new Date();
    return item;
  }
}
export const setup = () => { const repo = new FakeRepo(); return { repo, service: new MenuService(repo) }; };
export const rejects = (code: string, status: number) => (error: unknown) => error instanceof MenuError && error.code === code && error.status === status;


export {assert,MenuService,MenuError,normalizeName};
export type {MenuRepository,MenuItem,MenuInput,MenuFilters,Session};
