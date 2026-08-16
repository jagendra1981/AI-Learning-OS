import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class ReadModelExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as { error?: { code?: string; message?: string } };
      const code = body?.error?.code ?? (status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR');
      const message = body?.error?.message ?? 'Request could not be completed.';
      return response.status(status).json({ error: { code, message } });
    }
    return response.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: { code: 'READ_MODEL_UNAVAILABLE', message: 'Read model is temporarily unavailable.' } });
  }
}
