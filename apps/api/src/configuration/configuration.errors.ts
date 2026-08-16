import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
export const configError = (code: string, message: string): never => {
  throw new ConflictException({ code, message });
};
export const unknownConfig = (): never => {
  throw new NotFoundException({
    code: 'UNKNOWN_CONFIGURATION_VERSION',
    message: 'Configuration version was not found.',
  });
};
export const forbiddenConfig = (): never => {
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'You are not authorized for this configuration operation.',
  });
};
