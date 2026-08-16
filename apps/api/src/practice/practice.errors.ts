import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
export const practiceInvalid = (message = 'Practice request is invalid.') => {
  throw new BadRequestException({ code: 'PRACTICE_INVALID', message });
};
export const practiceForbidden = () => {
  throw new ForbiddenException({
    code: 'PRACTICE_FORBIDDEN',
    message: 'Practice session is not available.',
  });
};
export const practiceNotFound = () => {
  throw new NotFoundException({
    code: 'PRACTICE_NOT_FOUND',
    message: 'Practice session was not found.',
  });
};
export const practiceState = (
  message = 'Practice session state does not allow this operation.',
) => {
  throw new ConflictException({ code: 'PRACTICE_STATE_CONFLICT', message });
};
