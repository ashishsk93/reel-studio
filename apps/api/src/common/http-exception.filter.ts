import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorBody } from '@reel/shared';

/** Every error leaves the API as { statusCode, message, issues? }. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;

    let body: ApiErrorBody;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (typeof raw === 'string') {
        body = { statusCode: status, message: raw };
      } else {
        const obj = raw as { message?: unknown; issues?: ApiErrorBody['issues'] };
        const message = Array.isArray(obj.message) ? obj.message.join('; ') : String(obj.message ?? exception.message);
        body = { statusCode: status, message, ...(obj.issues ? { issues: obj.issues } : {}) };
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: exception instanceof Error ? exception.message : 'Unexpected error',
      };
    }
    response.status(body.statusCode).json(body);
  }
}
