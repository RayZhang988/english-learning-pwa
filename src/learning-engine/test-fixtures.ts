import type {
  AbilityDomain,
  AbilityEstimate,
  AbilityProfile,
} from '../features/assessment/index.ts'
import type {
  LearningAttemptCompletedEvent,
  LearningAttemptCompletedPayload,
  LearningCandidate,
} from './contracts.ts'

export function abilityEstimate(
  domain: AbilityDomain,
  input: {
    readonly status?: AbilityEstimate['status']
    readonly level?: number
    readonly confidence?: number
    readonly boundary?: AbilityEstimate['boundary']
  } = {},
): AbilityEstimate {
  const status = input.status ?? 'estimated'
  const level = status === 'unavailable' ? null : (input.level ?? 5)
  return {
    domain,
    status,
    internalLevel: level,
    internalRange:
      level === null
        ? null
        : {
            lower: Math.max(0, level - 1),
            upper: Math.min(12, level + 1),
          },
    score100: level === null ? null : Math.round((level / 12) * 100),
    cefrEstimate: level === null ? 'unknown' : 'B1',
    cefrRange:
      level === null ? null : { lower: 'A2', upper: 'B2' },
    confidence:
      status === 'unavailable' ? 0 : (input.confidence ?? 0.8),
    confidenceBand:
      status === 'unavailable'
        ? 'insufficient'
        : (input.confidence ?? 0.8) >= 0.75
          ? 'high'
          : 'low',
    standardError: level === null ? null : 0.8,
    evidenceCount: level === null ? 0 : 6,
    attemptedCount: level === null ? 2 : 6,
    reliability: level === null ? 0 : 0.9,
    boundary: input.boundary ?? (level === null ? 'unknown' : 'within-range'),
    message: 'fixture',
    warnings: [],
  }
}

export function abilityProfile(
  overrides: Partial<
    Readonly<Record<AbilityDomain, AbilityEstimate>>
  > = {},
): AbilityProfile {
  return {
    schemaVersion: 1,
    profileId: 'profile-1',
    assessmentId: 'assessment-1',
    bankId: 'bank-1',
    completedAt: '2026-07-01T00:00:00.000Z',
    durationSeconds: 900,
    outcome: 'completed',
    disclaimer: 'fixture',
    abilities: {
      vocabulary:
        overrides.vocabulary ?? abilityEstimate('vocabulary'),
      listening:
        overrides.listening ?? abilityEstimate('listening'),
      speaking: overrides.speaking ?? abilityEstimate('speaking'),
    },
  }
}

export function learningCandidate(
  domain: AbilityDomain,
  index: number,
  input: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    schemaVersion: 1,
    learningUnitId: `${domain}-${index}`,
    contentRef: `lesson://${domain}/${index}`,
    domain,
    difficultyLevel: 5,
    estimatedSeconds: 180,
    tags: ['fixture'],
    prerequisitesMet: true,
    ...input,
  }
}

export function attemptEvent(
  input: Partial<LearningAttemptCompletedPayload> & {
    readonly id?: string
    readonly occurredAt?: string
  } = {},
): LearningAttemptCompletedEvent {
  const domain = input.domain ?? 'vocabulary'
  const payload: LearningAttemptCompletedPayload = {
    planId: 'plan-1',
    taskId: 'task-1',
    learningUnitId: 'vocabulary-1',
    contentRef: 'lesson://vocabulary/1',
    domain,
    targetModuleId: domain,
    localDate: '2026-07-02',
    mode: 'learn',
    difficultyLevel: 5,
    estimatedSeconds: 180,
    result: 'scored',
    performanceScore: 0.8,
    evidenceQuality: 1,
    assistanceLevel: 0,
    durationSeconds: 120,
    taskCompleted: true,
    errorTags: [],
    contentTags: ['fixture'],
    failureCategory: null,
    ...input,
  }
  return {
    id: input.id ?? 'event-1',
    type: 'learning.attempt.completed.v1',
    sourceModuleId: payload.targetModuleId,
    occurredAt: input.occurredAt ?? '2026-07-02T00:00:00.000Z',
    schemaVersion: 1,
    payload,
  }
}
