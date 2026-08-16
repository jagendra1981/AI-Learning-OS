import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { createAuditEvent } from '../audit/audit-event';

const REVIEW_ROLES = ['CONTENT_REVIEWER', 'ACADEMIC_ADMIN', 'PLATFORM_ADMIN'];

type QueueItem = {
  itemId: string;
  itemType: 'QUESTION' | 'CONFIGURATION' | 'ACADEMIC_ISSUE';
  title: string;
  status: string;
  createdAt: Date;
  context: { examId: string; subjectId: string };
  actionNeeded: boolean;
};

@Injectable()
export class ReviewService {
  constructor(private readonly db: DatabaseService) {}

  private async reviewerRoles(userId: string) {
    const roles = await this.db.userRole.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { role: true, scope: true },
    });
    const authorized = roles.filter(({ role }) => REVIEW_ROLES.includes(role));
    if (!authorized.length) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
    }
    return authorized;
  }

  private canReadScope(roles: Array<{ role: string; scope: unknown }>, scopeKey: string | null) {
    return roles.some(({ role, scope }) =>
      role === 'PLATFORM_ADMIN' || (!scope && Boolean(scopeKey)) || (scopeKey !== null && JSON.stringify(scope).includes(scopeKey)),
    );
  }

  async queue(userId: string) {
    const authorized = await this.reviewerRoles(userId);
    const canReadScope = (scopeKey: string) => this.canReadScope(authorized, scopeKey);

    const [questions, configurations, academicIssues] = await Promise.all([
      this.db.questionVersion.findMany({
        where: { status: 'IN_REVIEW' },
        select: {
          questionVersionId: true,
          versionNumber: true,
          createdAt: true,
          question: { select: { questionId: true, examId: true, subjectId: true, scopeKey: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.configurationVersion.findMany({
        where: { status: 'APPROVED' },
        select: {
          configurationVersionId: true,
          versionNumber: true,
          createdAt: true,
          configurationSet: { select: { configurationSetId: true, examId: true, subjectId: true, scopeKey: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.academicIssue.findMany({
        where: { status: 'OPEN' },
        select: { issueId: true, summary: true, status: true, createdAt: true, examId: true, subjectId: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const items: QueueItem[] = [
      ...questions
        .filter(({ question }) => canReadScope(question.scopeKey))
        .map(({ questionVersionId, versionNumber, createdAt, question }) => ({
          itemId: questionVersionId,
          itemType: 'QUESTION' as const,
          title: `Question version ${versionNumber}`,
          status: 'IN_REVIEW',
          createdAt,
          context: { examId: question.examId, subjectId: question.subjectId },
          actionNeeded: true,
        })),
      ...configurations
        .filter(({ configurationSet }) => canReadScope(configurationSet.scopeKey))
        .map(({ configurationVersionId, versionNumber, createdAt, configurationSet }) => ({
          itemId: configurationVersionId,
          itemType: 'CONFIGURATION' as const,
          title: `Configuration version ${versionNumber}`,
          status: 'APPROVED',
          createdAt,
          context: {
            examId: configurationSet.examId,
            subjectId: configurationSet.subjectId,
          },
          actionNeeded: true,
        })),
      ...academicIssues
        .filter(({ examId, subjectId }) => canReadScope(`${examId ?? ''}:${subjectId ?? ''}`))
        .map((issue) => ({
          itemId: issue.issueId,
          itemType: 'ACADEMIC_ISSUE' as const,
          title: issue.summary,
          status: issue.status,
          createdAt: issue.createdAt,
          context: { examId: issue.examId ?? 'UNSPECIFIED', subjectId: issue.subjectId ?? 'UNSPECIFIED' },
          actionNeeded: true,
        })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { items };
  }

  async academicIssueDetail(userId: string, issueId: string) {
    const authorized = await this.reviewerRoles(userId);
    const issue = await this.db.academicIssue.findUnique({ where: { issueId } });
    if (!issue) throw new NotFoundException({ code: 'ACADEMIC_ISSUE_NOT_FOUND', message: 'Academic issue was not found.' });
    const scopeKey = issue.examId && issue.subjectId ? `${issue.examId}:${issue.subjectId}` : null;
    if (!this.canReadScope(authorized, scopeKey)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
    return {
      issueId: issue.issueId,
      itemType: 'ACADEMIC_ISSUE' as const,
      sourceType: issue.sourceType,
      summary: issue.summary,
      status: issue.status,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      context: { examId: issue.examId ?? 'UNSPECIFIED', subjectId: issue.subjectId ?? 'UNSPECIFIED' },
    };
  }

  async resolveAcademicIssue(userId: string, issueId: string) {
    const authorized = await this.reviewerRoles(userId);
    const issue = await this.db.academicIssue.findUnique({ where: { issueId } });
    if (!issue) throw new NotFoundException({ code: 'ACADEMIC_ISSUE_NOT_FOUND', message: 'Academic issue was not found.' });
    const scopeKey = issue.examId && issue.subjectId ? `${issue.examId}:${issue.subjectId}` : null;
    if (!this.canReadScope(authorized, scopeKey)) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this area.' });
    await this.db.transaction(async (tx) => {
      const result = await tx.academicIssue.updateMany({
        where: { issueId, status: 'OPEN' },
        data: { status: 'RESOLVED' },
      });
      if (result.count !== 1)
        throw new ConflictException({
          code: 'STALE_ISSUE',
          message: 'This academic issue is no longer open.',
        });
      await createAuditEvent(tx, {
        actorUserId: userId,
        subjectUserId: userId,
        action: 'ACADEMIC_ISSUE_RESOLVED',
        resourceType: 'AcademicIssue',
        resourceId: issueId,
        metadata: { previousStatus: 'OPEN', resultingStatus: 'RESOLVED' },
      });
    });
    return this.db.academicIssue.findUnique({ where: { issueId }, select: { issueId: true, status: true, updatedAt: true } });
  }
}
