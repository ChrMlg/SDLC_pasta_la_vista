import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { MenuError } from '../menu/menu.service';
import { OrderError } from '../orders/orders.service';
import { BillingError } from '../billing/billing.service';
import { NotificationError } from '../notifications/notifications.service';
import { AuthError } from '../auth/auth.service';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof MenuError || error instanceof OrderError || error instanceof BillingError || error instanceof NotificationError || error instanceof AuthError) {
      response.status(error.status).json({ code: error.code, message: error.message, field: error.field });
      return;
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      response.status(status).json({ code: status === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR', message: error.message, field: null });
      return;
    }
    this.logger.error(error);
    response.status(500).json({ code: 'INTERNAL_ERROR', message: 'Error del servidor', field: null });
  }
}
