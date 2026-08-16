import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
export const responseInvalid = (
  message = 'Response payload is invalid.',
): never => {
  throw new UnprocessableEntityException({ code: 'INVALID_RESPONSE', message });
};
export const responseConflict = (code = 'IDEMPOTENCY_CONFLICT'): never => {
  throw new ConflictException({
    code,
    message: 'The response submission conflicts with an existing submission.',
  });
};
