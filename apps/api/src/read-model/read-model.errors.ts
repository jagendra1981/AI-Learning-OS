import { HttpException, HttpStatus } from '@nestjs/common';
export class ReadModelError extends HttpException {
  constructor(code: string, status: HttpStatus, message: string) { super({ error: { code, message } }, status); }
}
export const validation = (message = 'Invalid query parameters.') => new ReadModelError('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, message);
export const invalidCursor = () => new ReadModelError('INVALID_CURSOR', HttpStatus.BAD_REQUEST, 'Invalid cursor.');
export const notFound = () => new ReadModelError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Requested scope was not found.');
