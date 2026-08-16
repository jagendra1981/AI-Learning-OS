import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';
import { DatabaseService } from '../database/database.service';

export type CreateSessionOptions = {
  expiresAt: Date;
  lastSeenAt?: Date;
  rotatedFromId?: string;
};

export type IssuedSession = {
  token: string;
  session: Session;
};

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class SessionAdapter {
  constructor(private readonly database: DatabaseService) {}

  async createSession(
    userId: string,
    options: CreateSessionOptions,
  ): Promise<IssuedSession> {
    const token = newSessionToken();
    const session = await this.database.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: options.expiresAt,
        lastSeenAt: options.lastSeenAt,
        rotatedFromId: options.rotatedFromId,
      },
    });
    return { token, session };
  }

  async resolveActiveSession(token: string): Promise<Session | null> {
    const session = await this.database.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return null;
    }
    return session;
  }

  async revokeSession(token: string, revokedAt = new Date()): Promise<void> {
    await this.database.session.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt },
    });
  }

  async revokeSessionsForUser(
    userId: string,
    revokedAt = new Date(),
  ): Promise<number> {
    const result = await this.database.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
    return result.count;
  }

  async rotateSession(
    token: string,
    options: CreateSessionOptions,
  ): Promise<IssuedSession | null> {
    const current = await this.resolveActiveSession(token);
    if (!current) return null;
    return this.database.transaction(async (transaction) => {
      await transaction.session.update({
        where: { sessionId: current.sessionId },
        data: { revokedAt: new Date() },
      });
      const nextToken = newSessionToken();
      const nextSession = await transaction.session.create({
        data: {
          userId: current.userId,
          tokenHash: hashSessionToken(nextToken),
          expiresAt: options.expiresAt,
          lastSeenAt: options.lastSeenAt,
          rotatedFromId: current.sessionId,
        },
      });
      return { token: nextToken, session: nextSession };
    });
  }
}
