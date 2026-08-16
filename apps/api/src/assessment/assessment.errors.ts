import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const assessmentNotFound = (): never => {
  throw new NotFoundException({
    code: 'ASSESSMENT_NOT_FOUND',
    message: 'Assessment resource was not found.',
  });
};
export const assessmentForbidden = (): never => {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You are not authorized for this assessment resource.',
  });
};
export const assessmentInvalid = (message: string): never => {
  throw new UnprocessableEntityException({
    code: 'INVALID_ASSESSMENT',
    message,
  });
};
export const assessmentStateConflict = (
  message = 'Assessment state does not permit this operation.',
): never => {
  throw new ConflictException({ code: 'INVALID_STATE_TRANSITION', message });
};
export const assessmentConcurrency = (): never => {
  throw new ConflictException({
    code: 'CONCURRENCY_CONFLICT',
    message:
      'The assessment changed concurrently. Retry with the latest state.',
  });
};
