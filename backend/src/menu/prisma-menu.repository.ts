import { PrismaClient, type Prisma } from '@prisma/client';
import type { MenuFilters, MenuInput, MenuItem, MenuRepository } from './menu.service';

const toItem = (value: {
  id: string; branchId: string; name: string; normalizedName: string; description: string | null;
  category: MenuItem['category']; price: { toFixed(digits: number): string }; isAvailable: boolean;
  createdAt: Date; updatedAt: Date; updatedById: string | null;
}): MenuItem => ({ ...value, price: value.price.toFixed(2) });

export class PrismaMenuRepository implements MenuRepository {
  constructor(private db: PrismaClient) {}

  async branchExists(branchId: string) {
    return (await this.db.branch.count({ where: { id: branchId } })) > 0;
  }
  async find(branchId: string, id: string) {
    const item = await this.db.menuItem.findFirst({ where: { id, branchId } });
    return item ? toItem(item) : null;
  }
  async create(branchId: string, input: MenuInput & { normalizedName: string }, userId: string) {
    return toItem(await this.db.menuItem.create({
      data: { branchId, name: input.name, normalizedName: input.normalizedName,
        description: input.description ?? null, category: input.category, price: input.price,
        createdById: userId },
    }));
  }
  async update(branchId: string, id: string, input: Partial<MenuInput> & { normalizedName?: string }, userId: string) {
    return toItem(await this.db.menuItem.update({
      where: { id, branchId }, data: { ...input, updatedById: userId },
    }));
  }
  async list(branchId: string, filters: MenuFilters) {
    const where: Prisma.MenuItemWhereInput = { branchId };
    if (filters.search !== undefined) where.name = { contains: filters.search, mode: 'insensitive' };
    if (filters.category !== undefined) where.category = filters.category;
    if (filters.isAvailable !== undefined) where.isAvailable = filters.isAvailable;
    const [items, total] = await this.db.$transaction([
      this.db.menuItem.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (filters.page - 1) * 10, take: 10 }),
      this.db.menuItem.count({ where }),
    ]);
    return { items: items.map(toItem), total };
  }
  async changeAvailability(branchId: string, id: string, isAvailable: boolean, userId: string) {
    return this.db.$transaction(async tx => {
      const current = await tx.menuItem.findFirst({ where: { id, branchId } });
      if (!current) return null;
      if (current.isAvailable === isAvailable) return 'conflict';
      const changed = await tx.menuItem.updateMany({
        where: { id, branchId, isAvailable: current.isAvailable },
        data: { isAvailable, updatedById: userId },
      });
      if (changed.count !== 1) return 'conflict';
      await tx.menuAvailabilityChange.create({
        data: { menuItemId: id, oldValue: current.isAvailable, newValue: isAvailable, changedById: userId },
      });
      const item = await tx.menuItem.findUniqueOrThrow({ where: { id } });
      return toItem(item);
    });
  }
}
