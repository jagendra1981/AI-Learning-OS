import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PilotStatus, Prisma } from '@prisma/client';
import { createAuditEvent } from '../audit/audit-event';
import { DatabaseService } from '../database/database.service';

const READ_ROLES = new Set(['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN']);
const WRITE_ROLES = new Set(['ACADEMIC_ADMIN', 'PLATFORM_ADMIN']);
const transitions: Record<PilotStatus, PilotStatus | undefined> = { DRAFT: 'READY', READY: 'ACTIVE', ACTIVE: 'COMPLETED', COMPLETED: undefined };

type Input = { name?: unknown; startsAt?: unknown; endsAt?: unknown; ownerUserId?: unknown };

@Injectable()
export class PilotService {
  constructor(private readonly db: DatabaseService) {}

  private async roles(userId: string, write = false) {
    const rows = await this.db.userRole.findMany({ where: { userId, status: 'ACTIVE' }, select: { role: true } });
    const allowed = rows.some(({ role }) => (write ? WRITE_ROLES : READ_ROLES).has(role));
    if (!allowed) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to pilot operations.' });
    return rows.map(({ role }) => role);
  }

  private parse(input: Input, partial = false) {
    const keys = Object.keys(input);
    if (keys.some((key) => !['name', 'startsAt', 'endsAt', 'ownerUserId'].includes(key))) throw new BadRequestException({ code: 'INVALID_PILOT_FIELDS', message: 'Only authorized pilot fields are accepted.' });
    const name = input.name === undefined && partial ? undefined : typeof input.name === 'string' ? input.name.trim() : '';
    if (name !== undefined && (!name || name.length > 160)) throw new BadRequestException({ code: 'INVALID_PILOT_NAME', message: 'Pilot name is required and must be at most 160 characters.' });
    const startsAt = input.startsAt === undefined && partial ? undefined : new Date(String(input.startsAt));
    if (startsAt && Number.isNaN(startsAt.getTime())) throw new BadRequestException({ code: 'INVALID_PILOT_DATE', message: 'startsAt must be a valid date.' });
    const endsAt = input.endsAt === undefined ? undefined : new Date(String(input.endsAt));
    if (endsAt && Number.isNaN(endsAt.getTime())) throw new BadRequestException({ code: 'INVALID_PILOT_DATE', message: 'endsAt must be a valid date.' });
    if (startsAt && endsAt && endsAt < startsAt) throw new BadRequestException({ code: 'INVALID_PILOT_DATES', message: 'endsAt cannot be earlier than startsAt.' });
    const ownerUserId = input.ownerUserId === undefined && partial ? undefined : typeof input.ownerUserId === 'string' ? input.ownerUserId : '';
    if (ownerUserId !== undefined && !/^[0-9a-f-]{36}$/i.test(ownerUserId)) throw new BadRequestException({ code: 'INVALID_PILOT_OWNER', message: 'ownerUserId must be a valid user id.' });
    return { ...(name !== undefined ? { name } : {}), ...(startsAt ? { startsAt } : {}), ...(endsAt !== undefined ? { endsAt } : {}), ...(ownerUserId !== undefined ? { ownerUserId } : {}) };
  }

  private async readiness(pilot: { name: string; startsAt: Date; endsAt: Date | null; ownerUserId: string }) {
    const owner = await this.db.user.findUnique({ where: { userId: pilot.ownerUserId }, select: { status: true } });
    const approvedConfig = await this.db.configurationVersion.count({ where: { status: 'APPROVED' } });
    const checks = { validPilotFields: Boolean(pilot.name.trim()) && (!pilot.endsAt || pilot.endsAt >= pilot.startsAt), activeOwner: owner?.status === 'ACTIVE', approvedConfiguration: approvedConfig > 0 };
    return { ready: Object.values(checks).every(Boolean), checks };
  }

  private view(pilot: any, readiness: unknown) { return { id: pilot.id, name: pilot.name, status: pilot.status, startsAt: pilot.startsAt, endsAt: pilot.endsAt, ownerUserId: pilot.ownerUserId, createdAt: pilot.createdAt, updatedAt: pilot.updatedAt, readiness }; }

  async list(userId: string) { await this.roles(userId); const pilots = await this.db.pilot.findMany({ orderBy: { createdAt: 'desc' } }); return { items: await Promise.all(pilots.map(async (p) => this.view(p, await this.readiness(p)))) }; }

  async create(userId: string, raw: unknown) {
    await this.roles(userId, true); const input = this.parse((raw ?? {}) as Input); const owner = await this.db.user.findFirst({ where: { userId: input.ownerUserId, status: 'ACTIVE' }, select: { userId: true } });
    if (!owner) throw new BadRequestException({ code: 'INVALID_PILOT_OWNER', message: 'Pilot owner must be an active user.' });
    const pilot = await this.db.transaction(async (tx) => { const created = await tx.pilot.create({ data: { name: input.name!, startsAt: input.startsAt!, endsAt: input.endsAt, ownerUserId: input.ownerUserId! } }); await createAuditEvent(tx, { actorUserId: userId, subjectUserId: userId, action: 'PILOT_CREATED', resourceType: 'Pilot', resourceId: created.id, metadata: { status: 'DRAFT' } }); return created; });
    return this.view(pilot, await this.readiness(pilot));
  }

  async get(userId: string, id: string) { await this.roles(userId); const pilot = await this.db.pilot.findUnique({ where: { id } }); if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' }); return this.view(pilot, await this.readiness(pilot)); }

  async readinessView(userId: string, id: string) { return this.get(userId, id); }

  async health(userId: string, id: string) {
    await this.roles(userId);
    const pilot = await this.db.pilot.findUnique({ where: { id }, select: { id: true } });
    if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' });
    const checkedAt = new Date();
    let database: 'ok' | 'unavailable' = 'ok';
    try { await this.db.ping(); } catch { database = 'unavailable'; }
    const ready = database === 'ok';
    return { pilotId: id, overall: ready ? 'HEALTHY' : 'UNREADY', checkedAt, api: 'ok', database, readiness: ready ? 'READY' : 'UNREADY' };
  }

  async issues(userId: string, id: string) {
    await this.roles(userId);
    const pilot = await this.db.pilot.findUnique({ where: { id }, select: { id: true } });
    if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' });
    const rows = await this.db.academicIssue.findMany({ where: { pilotId: id, status: 'OPEN' }, select: { issueId: true, status: true, summary: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' } });
    return { pilotId: id, count: rows.length, issues: rows };
  }

  async participants(userId: string, id: string) {
    await this.roles(userId);
    const pilot = await this.db.pilot.findUnique({ where: { id }, select: { id: true } });
    if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' });
    const rows = await this.db.pilotParticipant.findMany({ where: { pilotId: id }, select: { userId: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
    return { pilotId: id, count: rows.length, participants: rows.map(({ userId: participantId, createdAt }) => ({ userId: participantId, createdAt })) };
  }

  async addParticipant(actorUserId: string, pilotId: string, userId: string) {
    await this.roles(actorUserId, true);
    const pilot = await this.db.pilot.findUnique({ where: { id: pilotId }, select: { id: true } });
    if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' });
    const learner = await this.db.user.findFirst({ where: { userId, status: 'ACTIVE', roles: { some: { role: 'STUDENT', status: 'ACTIVE' } } }, select: { userId: true } });
    if (!learner) throw new BadRequestException({ code: 'INVALID_PILOT_PARTICIPANT', message: 'Participant must be an active learner.' });
    try {
      const row = await this.db.transaction(async (tx) => { const created = await tx.pilotParticipant.create({ data: { pilotId, userId } }); await createAuditEvent(tx, { actorUserId, subjectUserId: actorUserId, action: 'PILOT_PARTICIPANT_ADDED', resourceType: 'Pilot', resourceId: pilotId, metadata: { participantUserId: userId } }); return created; });
      return { pilotId: row.pilotId, userId: row.userId, createdAt: row.createdAt };
    } catch (error) { if ((error as { code?: string }).code === 'P2002') throw new ConflictException({ code: 'PILOT_PARTICIPANT_EXISTS', message: 'Participant is already associated with this pilot.' }); throw error; }
  }

  async removeParticipant(actorUserId: string, pilotId: string, userId: string) {
    await this.roles(actorUserId, true);
    const pilot = await this.db.pilot.findUnique({ where: { id: pilotId }, select: { id: true } });
    if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' });
    const row = await this.db.pilotParticipant.findUnique({ where: { pilotId_userId: { pilotId, userId } } });
    if (!row) throw new NotFoundException({ code: 'PILOT_PARTICIPANT_NOT_FOUND', message: 'Pilot participant was not found.' });
    await this.db.transaction(async (tx) => { await tx.pilotParticipant.delete({ where: { pilotId_userId: { pilotId, userId } } }); await createAuditEvent(tx, { actorUserId, subjectUserId: actorUserId, action: 'PILOT_PARTICIPANT_REMOVED', resourceType: 'Pilot', resourceId: pilotId, metadata: { participantUserId: userId } }); });
    return { pilotId, userId, removed: true };
  }

  async update(userId: string, id: string, raw: unknown) {
    await this.roles(userId, true); const pilot = await this.db.pilot.findUnique({ where: { id } }); if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' }); if (pilot.status !== 'DRAFT') throw new ConflictException({ code: 'PILOT_IMMUTABLE', message: 'Only draft pilots can be edited.' }); const input = this.parse(raw as Input, true); if (input.ownerUserId) { const owner = await this.db.user.findFirst({ where: { userId: input.ownerUserId, status: 'ACTIVE' }, select: { userId: true } }); if (!owner) throw new BadRequestException({ code: 'INVALID_PILOT_OWNER', message: 'Pilot owner must be an active user.' }); }
    const updated = await this.db.transaction(async (tx) => { const result = await tx.pilot.update({ where: { id }, data: input as Prisma.PilotUpdateInput }); await createAuditEvent(tx, { actorUserId: userId, subjectUserId: userId, action: 'PILOT_CONFIGURATION_CHANGED', resourceType: 'Pilot', resourceId: id, metadata: { changedFields: Object.keys(input) } }); return result; }); return this.view(updated, await this.readiness(updated));
  }

  async transition(userId: string, id: string, target: PilotStatus, raw?: unknown) {
    await this.roles(userId, true); const pilot = await this.db.pilot.findUnique({ where: { id } }); if (!pilot) throw new NotFoundException({ code: 'PILOT_NOT_FOUND', message: 'Pilot was not found.' }); if (transitions[pilot.status] !== target) throw new ConflictException({ code: 'INVALID_PILOT_TRANSITION', message: `Cannot transition pilot from ${pilot.status} to ${target}.` }); const ready = await this.readiness(pilot); if (target === 'READY' && !ready.ready) throw new ConflictException({ code: 'PILOT_NOT_READY', message: 'Pilot readiness requirements are not satisfied.' }); if (target === 'ACTIVE' && (!ready.ready || pilot.startsAt > new Date())) throw new ConflictException({ code: 'PILOT_NOT_READY', message: 'Pilot is not ready to activate.' }); const body = (raw ?? {}) as Input; const endsAt = target === 'COMPLETED' ? new Date(String(body.endsAt ?? pilot.endsAt ?? '')) : undefined; if (target === 'COMPLETED' && (!endsAt || Number.isNaN(endsAt.getTime()) || endsAt < pilot.startsAt)) throw new BadRequestException({ code: 'INVALID_PILOT_COMPLETION', message: 'Completion requires a valid endsAt.' });
    const closureEvidence = (raw as { closureEvidence?: unknown } | undefined)?.closureEvidence;
    if (target === 'COMPLETED' && (typeof closureEvidence !== 'string' || closureEvidence.trim().length < 1 || closureEvidence.length > 500))
      throw new BadRequestException({ code: 'INVALID_PILOT_CLOSURE_EVIDENCE', message: 'Completion requires bounded closure evidence.' });
    const action = target === 'READY' ? 'PILOT_READY' : target === 'ACTIVE' ? 'PILOT_ACTIVATED' : 'PILOT_COMPLETED'; const updated = await this.db.transaction(async (tx) => { const result = await tx.pilot.updateMany({ where: { id, status: pilot.status }, data: { status: target, ...(endsAt ? { endsAt } : {}) } }); if (result.count !== 1) throw new ConflictException({ code: 'STALE_PILOT', message: 'Pilot state changed; retry.' }); const next = await tx.pilot.findUniqueOrThrow({ where: { id } }); await createAuditEvent(tx, { actorUserId: userId, subjectUserId: userId, action, resourceType: 'Pilot', resourceId: id, metadata: { previousStatus: pilot.status, resultingStatus: target, ...(target === 'COMPLETED' ? { closureEvidenceProvided: true } : {}) } }); return next; }); return this.view(updated, await this.readiness(updated));
  }
}
