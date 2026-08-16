import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Backend-authoritative guard for learner Tutor access during active graded work. */
@Injectable()
export class TutorAssessmentRestrictionService {
  constructor(private readonly db: DatabaseService) {}

  async isTutorAllowed(learnerId: string): Promise<boolean> {
    const now = new Date();
    const activeAssessment = await this.db.assessmentSession.findFirst({
      where: {
        ownerUserId: learnerId,
        state: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { assessmentSessionId: true },
    });
    return !activeAssessment;
  }
}
