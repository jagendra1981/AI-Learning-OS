import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
export const testNotFound = (): never => {
  throw new NotFoundException({
    code: 'TEST_NOT_FOUND',
    message: 'Test resource was not found.',
  });
};
export const testForbidden = (): never => {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You are not authorized for this test resource.',
  });
};
export const testInvalid = (message = 'Test request is invalid.'): never => {
  throw new UnprocessableEntityException({ code: 'INVALID_TEST', message });
};
export const testConflict = (
  message = 'Test state does not permit this operation.',
): never => {
  throw new ConflictException({ code: 'INVALID_TEST_STATE', message });
};
