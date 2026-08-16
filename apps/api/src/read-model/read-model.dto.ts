export type ProjectionState =
  'AVAILABLE' | 'EMPTY' | 'PENDING' | 'STALE' | 'UNAVAILABLE';
export type ActionType =
  'NAVIGATE' | 'START_PRACTICE' | 'CONTINUE_PRACTICE' | 'OPEN_REVISION';
export type ActionReference = {
  type: ActionType;
  href?: '/practice' | '/revision';
  resourceId?: string;
  label?: string;
  disabledReason?: string;
};
export type ReadMeta = {
  schemaVersion: string;
  source: string;
  sourceVersion: string | null;
  sourceGeneration: string | null;
  sourceWatermark: string | null;
};
export type Freshness = {
  state: ProjectionState;
  generatedAt: string | null;
  asOf?: string | null;
  stale?: boolean;
  retryable?: boolean;
  reasonCode?: string;
};
export type ReadEnvelope<T> = {
  state: ProjectionState;
  generatedAt: string | null;
  data: T | null;
  freshness: Freshness;
  meta: ReadMeta;
};
export type ReadQuery = {
  contextId?: string;
  academicVersion?: string;
  asOf?: string;
};
export type MistakeQuery = ReadQuery & {
  lifecycle?: string;
  conceptId?: string;
  includeResolved?: string;
  limit?: string;
  cursor?: string;
};
export type RevisionQuery = ReadQuery & {
  state?: string;
  dueStatus?: string;
  conceptId?: string;
  limit?: string;
  cursor?: string;
};
export type TodayQuery = ReadQuery & {
  planDateLocal?: string;
  includeCompleted?: string;
};
export type ProgressQuery = ReadQuery;

export type NbaDto = {
  actionType: string;
  title: string;
  reason?: string;
  targetLabel?: string;
  action?: ActionReference;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  expiresAt?: string | null;
};
export type ProgressBand =
  'FOUNDATION' | 'DEVELOPING' | 'PROGRESSING' | 'STRONG';
export type ProgressSubjectDto = {
  subjectId: string;
  subjectLabel: string;
  progressPercent?: number;
  band?: ProgressBand;
  eligibleConceptCount: number;
  totalConceptCount: number;
};
export type ProgressDto = {
  state: ProjectionState;
  overallProgressPercent?: number;
  overallBand?: ProgressBand;
  coverage?: {
    eligibleConceptCount: number;
    totalConceptCount: number;
    coveragePercent: number;
  };
  subjects?: ProgressSubjectDto[];
  eligibleConceptCount: number;
  totalConceptCount: number;
  generatedAt: string;
  asOf?: string | null;
  academicVersionId?: string;
};
export type MistakeDto = {
  mistakeId?: string;
  category: string;
  label: string;
  concept?: { id: string; label?: string };
  recurrence?: number;
  explanation?: string;
  severity?: string;
  recoveryAction?: ActionReference;
  lastObservedAt?: string | null;
};
export type RevisionDto = {
  itemId: string;
  title: string;
  concept?: { id: string; label?: string };
  state: string;
  priority?: string;
  reason?: string;
  dueAt?: string | null;
  action?: ActionReference;
};
