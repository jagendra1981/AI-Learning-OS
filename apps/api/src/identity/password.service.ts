import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(password: string, encoded: string | null): Promise<boolean> {
    if (!encoded?.startsWith('$argon2id$')) return false;
    try {
      return await argon2.verify(encoded, password);
    } catch {
      return false;
    }
  }
}
