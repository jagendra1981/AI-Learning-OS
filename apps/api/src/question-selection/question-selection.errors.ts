import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

export const selectionValidation = (message: string): never => {
  throw new BadRequestException({ code: 'VALIDATION_FAILED', message });
};
export const selectionUnknownVersion = (): never => {
  throw new NotFoundException({
    code: 'UNKNOWN_VERSION',
    message: 'Syllabus version was not found.',
  });
};
export const selectionConflict = (): never => {
  throw new ConflictException({
    code: 'NO_ELIGIBLE_CANDIDATE',
    message: 'No eligible question is available.',
  });
};
