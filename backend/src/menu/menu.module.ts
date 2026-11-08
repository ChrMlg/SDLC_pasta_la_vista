import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { VerifiedSessionGuard } from '../common/session';
import { MenuController } from './menu.controller';
import { PrismaMenuRepository } from './prisma-menu.repository';
import { MenuService } from './menu.service';

@Module({
  controllers: [MenuController],
  providers: [
    VerifiedSessionGuard,
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    { provide: PrismaMenuRepository, useFactory: (db: PrismaClient) => new PrismaMenuRepository(db), inject: [PrismaClient] },
    { provide: MenuService, useFactory: (repo: PrismaMenuRepository) => new MenuService(repo), inject: [PrismaMenuRepository] },
  ],
})
export class MenuModule {}
