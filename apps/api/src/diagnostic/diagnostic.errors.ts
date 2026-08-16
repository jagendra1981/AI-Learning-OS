import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
export const diagnosticNotFound = (): never => {
  throw new NotFoundException({
    code: 'DIAGNOSTIC_NOT_FOUND',
    message: 'Diagnostic resource was not found.',
  });
};
export const diagnosticForbidden = (): never => {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You are not authorized for this diagnostic resource.',
  });
};
export const diagnosticInvalid = (message: string): never => {
  throw new UnprocessableEntityException({
    code: 'INVALID_DIAGNOSTIC',
    message,
  });
};
export const diagnosticState = (
  message = 'Diagnostic state does not permit this operation.',
): never => {
  throw new ConflictException({ code: 'INVALID_DIAGNOSTIC_STATE', message });
};
export const diagnosticConcurrency = (): never => {
  throw new ConflictException({
    code: 'DIAGNOSTIC_CONCURRENCY_CONFLICT',
    message:
      'The diagnostic changed concurrently. Retry with the latest state.',
  });
};
