import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { loadServerConfig } from '@ai-learning-os/config';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const url = loadServerConfig().database.url;
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async transaction<T>(
    operation: (client: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(operation);
  }
}
