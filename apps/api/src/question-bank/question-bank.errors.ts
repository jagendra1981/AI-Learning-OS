import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

export const questionConflict = (code: string, message: string): never => {
  throw new ConflictException({ code, message });
};
export const questionForbidden = (): never => {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You are not authorized for this question operation.',
  });
};
export const questionNotFound = (): never => {
  throw new NotFoundException({
    code: 'UNKNOWN_QUESTION_VERSION',
    message: 'Question version was not found.',
  });
};
