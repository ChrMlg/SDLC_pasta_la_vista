import 'reflect-metadata';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from './prisma/prisma.module';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiErrorFilter } from './common/menu-error.filter';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { BillingModule } from './billing/billing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { ReservationsModule } from './reservations/reservations.module';
import { InventoryModule } from './inventory/inventory.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReviewsModule } from './reviews/reviews.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { AuthService } from './auth/auth.service';
import type { AuthenticatedRequest } from './common/session';

@Controller('health')
class HealthController {
  constructor(private readonly db: PrismaClient) {}
  @Get()
  async health() { await this.db.$queryRaw`SELECT 1`; return { status: 'ok' }; }
}

@Module({ controllers: [HealthController], imports: [PrismaModule, AuthModule, MenuModule, OrdersModule, BillingModule, NotificationsModule, ReservationsModule, InventoryModule, KitchenModule, ReviewsModule, AnalyticsModule] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const origins = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, credentials: true });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Pasta la Vista — API').setVersion('1.0.0')
    .setDescription('Iniciar sesión en POST /api/auth/login. La sesión usa la cookie HttpOnly bistro_session. Los permisos dependen del rol y la sucursal.')
    .addCookieAuth('bistro_session').build());
  document.security = [{ cookie: [] }];
  for (const path of ['/api/auth/login', '/api/auth/register/customer', '/api/health']) {
    for (const method of ['get', 'post'] as const) {
      const operation = document.paths[path]?.[method];
      if (operation) operation.security = [];
    }
  }
  SwaggerModule.setup('api/docs', app, document, { swaggerOptions: { withCredentials: true } });
  app.useGlobalFilters(new ApiErrorFilter());
  const auth = app.get(AuthService);
  app.use((request: AuthenticatedRequest, _response: unknown, next: (error?: unknown) => void) => {
    void auth.attach(request).then(() => next(), error => next(error));
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
