import { Injectable } from '@nestjs/common';
import { PolicyMode, TutorContext } from './tutor-orchestrator.types';

export type AssistanceDecision = {
  mode: PolicyMode;
  allowHints: boolean;
  allowAnswer: boolean;
  allowSolution: boolean;
  allowWorkedExample: boolean;
  allowCode: boolean;
  allowTools: boolean;
  status: 'ANSWER' | 'HINT' | 'QUESTION' | 'REFUSAL';
};

@Injectable()
export class TutorPolicyService {
  resolve(context: TutorContext): AssistanceDecision {
    const assessment = context.assessment ?? {};
    const active = assessment.active === true;
    const released = assessment.released === true;
    const retryLocked =
      context.activity === 'RETRY' && assessment.locked === true;
    if (active && context.activity === 'GRADED_ASSESSMENT')
      return {
        mode: 'ASSESSMENT_RESTRICTED',
        allowHints: false,
        allowAnswer: false,
        allowSolution: false,
        allowWorkedExample: false,
        allowCode: false,
        allowTools: false,
        status: 'REFUSAL',
      };
    if (active && context.activity === 'DIAGNOSTIC')
      return {
        mode: 'ASSESSMENT_RESTRICTED',
        allowHints: false,
        allowAnswer: false,
        allowSolution: false,
        allowWorkedExample: false,
        allowCode: false,
        allowTools: false,
        status: 'QUESTION',
      };
    if (retryLocked)
      return {
        mode: 'RETRY_GUIDED',
        allowHints: true,
        allowAnswer: false,
        allowSolution: false,
        allowWorkedExample: true,
        allowCode: false,
        allowTools: true,
        status: 'HINT',
      };
    if (context.activity === 'PRACTICE' && !released)
      return {
        mode: 'PRACTICE_GUIDED',
        allowHints: true,
        allowAnswer: false,
        allowSolution: false,
        allowWorkedExample: true,
        allowCode: true,
        allowTools: true,
        status: 'HINT',
      };
    if (context.activity === 'COMPLETED_REVIEW' && !released)
      return {
        mode: 'POST_RELEASE',
        allowHints: true,
        allowAnswer: false,
        allowSolution: false,
        allowWorkedExample: true,
        allowCode: true,
        allowTools: true,
        status: 'ANSWER',
      };
    return {
      mode: 'GENERAL',
      allowHints: true,
      allowAnswer: true,
      allowSolution: true,
      allowWorkedExample: true,
      allowCode: true,
      allowTools: true,
      status: 'ANSWER',
    };
  }
}
