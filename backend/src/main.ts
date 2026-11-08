import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiErrorFilter } from './common/menu-error.filter';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { BillingModule } from './billing/billing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import type { AuthenticatedRequest } from './common/session';

@Module({ imports: [AuthModule, MenuModule, OrdersModule, BillingModule, NotificationsModule] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiErrorFilter());
  const auth = app.get(AuthService);
  app.use((request: AuthenticatedRequest, _response: unknown, next: (error?: unknown) => void) => {
    void auth.attach(request).then(() => next(), error => next(error));
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
