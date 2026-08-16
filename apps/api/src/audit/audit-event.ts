import { Prisma } from '@prisma/client';

export type AuditEventInput = {
  actorUserId: string;
  subjectUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Prisma.InputJsonValue;
};

export function createAuditEvent(
  db: Pick<Prisma.TransactionClient, 'auditEvent'> | { auditEvent: Prisma.TransactionClient['auditEvent'] },
  input: AuditEventInput,
) {
  return db.auditEvent.create({ data: input });
}
