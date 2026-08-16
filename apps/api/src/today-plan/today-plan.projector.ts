export const C025_ENGINE_ID = 'today-plan-service-v1';
export const C025_ALGORITHM_ID = 'today-plan-generation-v1';
export const C025_CONFIG_ID = 'today-plan-config-v1';
export const C025_PROCESSING_VERSION = 'c025-v1';
export const C025_CONTRACT_VERSION = 'C025-TODAY-PLAN-SERVICE-CONTRACT-V1';
export const DAILY_CAPACITY_MINUTES = 120;
export const DEFAULT_ITEM_DURATION_MINUTES = 20;
export const MAX_DAILY_ITEMS = 5;
export const MAX_POSTPONES_PER_30_DAYS = 2;

export type PlanState = 'ACTIVE' | 'SUPERSEDED' | 'COMPLETED';
export type ItemState =
  | 'PLANNED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'POSTPONED'
  | 'UNAVAILABLE'
  | 'SUPERSEDED';
export type OperationRank = 1 | 2 | 3 | 4 | 5;
export type PlanScope = {
  learnerId: string;
  contextId: string;
  academicVersionId: string;
  planDateLocal: string;
  learnerTimezone: string;
};
export type C024Candidate = {
  immutableCandidateId: string;
  candidateType: string;
  conceptId: string;
  targetRefId: string;
  rank: number;
  selected?: boolean;
  finalScore?: number;
  reasonCodes?: string[];
  explanation?: string;
  available: boolean;
  availabilityReason?: string;
  estimatedDurationMinutes?: number | null;
};
export type TodayPlanCandidateSnapshot = Readonly<C024Candidate>;
export type TodayPlanAdaptiveInputSnapshot = Readonly<{
  adaptiveRunId: string | null;
  generationId: string | null;
  selectedCandidateId: string | null;
  engineId: string | null;
  algorithmId: string | null;
  configId: string | null;
  processingVersion: string | null;
  contractVersion: string | null;
  candidates: readonly TodayPlanCandidateSnapshot[];
}>;
export const normalizeAdaptiveSnapshot = (input: {
  adaptiveRunId?: string | null;
  generationId?: string | null;
  selectedCandidateId?: string | null;
  engineId?: string | null;
  algorithmId?: string | null;
  configId?: string | null;
  processingVersion?: string | null;
  contractVersion?: string | null;
  candidates: readonly C024Candidate[];
}): TodayPlanAdaptiveInputSnapshot => ({
  adaptiveRunId: input.adaptiveRunId ?? null,
  generationId: input.generationId ?? null,
  selectedCandidateId: input.selectedCandidateId ?? null,
  engineId: input.engineId ?? null,
  algorithmId: input.algorithmId ?? null,
  configId: input.configId ?? null,
  processingVersion: input.processingVersion ?? null,
  contractVersion: input.contractVersion ?? null,
  candidates: [...input.candidates]
    .map((c) => ({
      ...c,
      selected:
        c.immutableCandidateId === (input.selectedCandidateId ?? undefined),
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.immutableCandidateId.localeCompare(b.immutableCandidateId),
    ),
});
const canonical = (value: unknown): string =>
  value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(',')}}`;
export const canonicalAdaptiveSnapshot = (
  snapshot: TodayPlanAdaptiveInputSnapshot,
) => canonical(snapshot);
export type PlanItem = C024Candidate & {
  planItemId: string;
  semanticItemKey: string;
  sequence: number;
  durationMinutes: number;
  mandatory: boolean;
  state: ItemState;
  itemVersion: 1;
  availabilitySnapshot: boolean;
  completionEvidenceRef?: string;
};
export type PlanVersion = {
  planVersion: number;
  state: PlanState;
  items: PlanItem[];
  reason?: string;
  sourceGenerationId?: string;
};
export type PlanEvent = {
  immutableEventId: string;
  effectiveAt: Date;
  operationRank: OperationRank;
  payloadHash: string;
};

export type C025Operation = PlanEvent & {
  type: 'GENERATE' | 'COMPLETE' | 'POSTPONE' | 'REPLAN';
  scope: PlanScope;
  payload: {
    snapshot?: TodayPlanAdaptiveInputSnapshot;
    candidates?: C024Candidate[];
    itemId?: string;
    semanticItemKey?: string;
    evidenceRef?: string;
    requestedDateLocal?: string;
    reasonCode?: string;
    sourceGenerationId?: string;
  };
};
export type C025FoldState = {
  current: PlanVersion | null;
  history: PlanVersion[];
  watermark: PlanEvent | null;
};

export const c025Genesis = (): C025FoldState => ({
  current: null,
  history: [],
  watermark: null,
});

export const comparePlanEvents = (a: PlanEvent, b: PlanEvent) =>
  a.effectiveAt.getTime() - b.effectiveAt.getTime() ||
  a.operationRank - b.operationRank ||
  a.immutableEventId.localeCompare(b.immutableEventId);

export function isLatePlanInput(
  incoming: PlanEvent,
  watermark: PlanEvent | null,
) {
  return watermark !== null && comparePlanEvents(incoming, watermark) < 0;
}

export function foldC025FromGenesis(
  operations: readonly C025Operation[],
): C025FoldState {
  const state = c025Genesis();
  for (const operation of [...operations].sort(comparePlanEvents)) {
    if (state.watermark && comparePlanEvents(operation, state.watermark) < 0) {
      // Rebuild callers provide the complete set; sorting here makes late input deterministic.
    }
    if (operation.type === 'GENERATE' || operation.type === 'REPLAN') {
      const nextVersion = (state.current?.planVersion ?? 0) + 1;
      const generated = generatePlan(
        operation.payload.snapshot?.candidates ??
          operation.payload.candidates ??
          [],
        nextVersion,
        operation.payload.snapshot?.generationId ??
          operation.payload.sourceGenerationId ??
          undefined,
      );
      const completed =
        state.current?.items.filter((item) => item.state === 'COMPLETED') ?? [];
      const preserved = completed.map((item, index) => ({
        ...item,
        planItemId: `${nextVersion}:completed:${index + 1}:${item.immutableCandidateId}`,
        sequence: index + 1,
      }));
      const pending = generated.items
        .filter(
          (item) =>
            !completed.some(
              (old) => old.semanticItemKey === item.semanticItemKey,
            ),
        )
        .map((item, index) => ({
          ...item,
          sequence: preserved.length + index + 1,
          planItemId: `${nextVersion}:${preserved.length + index + 1}:${item.immutableCandidateId}`,
        }));
      const next = { ...generated, items: [...preserved, ...pending] };
      if (
        !state.current ||
        JSON.stringify(
          state.current.items.map((x) => [x.semanticItemKey, x.state]),
        ) !==
          JSON.stringify(next.items.map((x) => [x.semanticItemKey, x.state]))
      ) {
        if (state.current) state.history.push(state.current);
        state.current = next;
      }
    } else if (
      operation.type === 'COMPLETE' &&
      state.current &&
      (operation.payload.semanticItemKey || operation.payload.itemId)
    ) {
      state.current = {
        ...state.current,
        items: state.current.items.map((item) =>
          item.semanticItemKey === operation.payload.semanticItemKey ||
          item.planItemId === operation.payload.itemId
            ? transitionItem(item, 'COMPLETED', operation.payload.evidenceRef)
            : item,
        ),
      };
    } else if (
      operation.type === 'POSTPONE' &&
      state.current &&
      (operation.payload.semanticItemKey || operation.payload.itemId)
    ) {
      const postponed = {
        ...state.current,
        items: state.current.items.map((item) =>
          item.semanticItemKey === operation.payload.semanticItemKey ||
          item.planItemId === operation.payload.itemId
            ? transitionItem(item, 'POSTPONED')
            : item,
        ),
      };
      state.history.push(postponed);
      const nextVersion = postponed.planVersion + 1;
      state.current = {
        planVersion: nextVersion,
        state: 'ACTIVE',
        sourceGenerationId: postponed.sourceGenerationId,
        items: postponed.items
          .filter((item) => item.state === 'COMPLETED')
          .map((item, index) => ({
            ...item,
            planItemId: `${nextVersion}:completed:${index + 1}:${item.immutableCandidateId}`,
            sequence: index + 1,
          })),
      };
    }
    state.watermark = operation;
  }
  return state;
}

const semanticKey = (c: C024Candidate) =>
  `${c.candidateType}|${c.conceptId}|${c.targetRefId}`;

export function generatePlan(
  candidates: readonly C024Candidate[],
  version = 1,
  sourceGenerationId?: string,
): PlanVersion {
  const ordered = [...candidates].sort(
    (a, b) =>
      a.rank - b.rank ||
      a.immutableCandidateId.localeCompare(b.immutableCandidateId),
  );
  const selected = ordered.find((c) => c.selected);
  const rest = ordered.filter((c) => !c.selected);
  const sequence = selected ? [selected, ...rest] : ordered;
  const items: PlanItem[] = [];
  let total = 0;
  for (const c of sequence) {
    if (items.length >= MAX_DAILY_ITEMS) break;
    if (!c.available) continue;
    const duration =
      c.estimatedDurationMinutes ?? DEFAULT_ITEM_DURATION_MINUTES;
    const first = items.length === 0 && c.selected;
    if (!first && total + duration > DAILY_CAPACITY_MINUTES) continue;
    total += duration;
    items.push({
      ...c,
      planItemId: `${version}:${items.length + 1}:${c.immutableCandidateId}`,
      semanticItemKey: semanticKey(c),
      sequence: items.length + 1,
      durationMinutes: duration,
      mandatory: Boolean(first),
      state: 'AVAILABLE',
      itemVersion: 1,
      availabilitySnapshot: true,
    });
  }
  return {
    planVersion: version,
    state: 'ACTIVE',
    items,
    sourceGenerationId,
    reason: items.length ? undefined : 'NO_AVAILABLE_PLAN_ITEMS',
  };
}

const transitions: Record<ItemState, readonly ItemState[]> = {
  PLANNED: ['AVAILABLE', 'UNAVAILABLE'],
  AVAILABLE: [
    'IN_PROGRESS',
    'COMPLETED',
    'POSTPONED',
    'UNAVAILABLE',
    'SUPERSEDED',
  ],
  IN_PROGRESS: ['COMPLETED', 'UNAVAILABLE', 'SUPERSEDED'],
  POSTPONED: ['SUPERSEDED'],
  UNAVAILABLE: ['SUPERSEDED'],
  COMPLETED: [],
  SUPERSEDED: [],
};
export function canTransition(from: ItemState, to: ItemState) {
  return transitions[from].includes(to);
}
export function transitionItem(
  item: PlanItem,
  to: ItemState,
  evidence?: string,
) {
  if (!canTransition(item.state, to))
    throw new Error(`INVALID_STATE:${item.state}->${to}`);
  return {
    ...item,
    state: to,
    ...(evidence ? { completionEvidenceRef: evidence } : {}),
  };
}

export function validatePostponeDate(current: string, requested: string) {
  const start = new Date(`${current}T00:00:00Z`);
  const target = new Date(`${requested}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(requested) ||
    target <= start ||
    target > new Date(start.getTime() + 7 * 86400000)
  )
    throw new Error('POSTPONE_DATE_INVALID');
}

export function validatePostponeLimit(postponesInPrevious30Days: number) {
  if (postponesInPrevious30Days >= MAX_POSTPONES_PER_30_DAYS)
    throw new Error('POSTPONE_LIMIT_REACHED');
}

export function planDateLocalAt(instant: Date, learnerTimezone: string) {
  if (Number.isNaN(instant.getTime())) throw new Error('INVALID_TIMESTAMP');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: learnerTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
