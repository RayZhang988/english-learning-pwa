import type {
  AbilityDomain,
  DailyPlan,
  DailyPlanInput,
  DomainAllocation,
  LearningCandidate,
  LearningTask,
  LearningTaskMode,
  ProgressState,
  ReviewItemState,
  TaskDurationEstimate,
  TaskOrigin,
} from './contracts.ts'
import {
  DEFAULT_DAILY_TARGET_SECONDS,
  MINIMUM_DAILY_BUDGET_SECONDS,
  REQUIRED_TASK_EFFECTIVE_SECONDS,
} from './contracts.ts'
import { buildProgressSnapshot } from './progress.ts'
import { isRetryDue, isReviewDue } from './review.ts'
import { estimateTaskDuration } from './timing.ts'
import {
  ABILITY_DOMAINS,
  assertLocalDate,
  clamp,
  parseTimestamp,
  round,
} from './utils.ts'

interface TaskSeed {
  readonly learningUnitId: string
  readonly contentRef: string
  readonly domain: AbilityDomain
  readonly mode: LearningTaskMode
  readonly origin: TaskOrigin
  readonly difficultyLevel: number
  readonly estimatedSeconds: number
  readonly durationEstimate: TaskDurationEstimate
  readonly required: boolean
  readonly dueAt: string | null
  readonly skipLimit: number
  readonly tags: readonly string[]
}

interface PreparedCandidate {
  readonly candidate: LearningCandidate
  readonly mode: LearningTaskMode
  readonly durationEstimate: TaskDurationEstimate
}

function progressScore(progress: ProgressState, domain: AbilityDomain): number {
  const state = progress.domains[domain]
  return clamp(
    0.45 * state.masteryScore +
      0.35 * state.recentPerformance +
      0.2 * state.retentionScore,
    0,
    1,
  )
}

function calculateWeaknessWeights(
  progress: ProgressState,
): Readonly<Record<AbilityDomain, number>> {
  const needs = Object.fromEntries(
    ABILITY_DOMAINS.map((domain) => {
      const state = progress.domains[domain]
      const need =
        0.45 * (1 - state.currentLevel / 12) +
        0.35 * (1 - progressScore(progress, domain)) +
        0.2 * (1 - state.confidence)
      return [domain, Math.max(0.01, need)]
    }),
  ) as Record<AbilityDomain, number>
  const totalNeed = ABILITY_DOMAINS.reduce(
    (total, domain) => total + needs[domain],
    0,
  )
  const weights = Object.fromEntries(
    ABILITY_DOMAINS.map((domain) => [
      domain,
      0.2 + (0.4 * needs[domain]) / totalNeed,
    ]),
  ) as Record<AbilityDomain, number>

  const cappedDomain = ABILITY_DOMAINS.find(
    (domain) => weights[domain] > 0.5,
  )
  if (cappedDomain !== undefined) {
    const excess = weights[cappedDomain] - 0.5
    weights[cappedDomain] = 0.5
    const recipients = ABILITY_DOMAINS.filter(
      (domain) => domain !== cappedDomain,
    )
    const recipientTotal = recipients.reduce(
      (total, domain) => total + weights[domain],
      0,
    )
    for (const domain of recipients) {
      weights[domain] += excess * (weights[domain] / recipientTotal)
    }
  }

  return {
    vocabulary: round(weights.vocabulary),
    listening: round(weights.listening),
    speaking: round(weights.speaking),
  }
}

function calculateTargetDifficulties(
  input: DailyPlanInput,
): Readonly<Record<AbilityDomain, number>> {
  const snapshot = buildProgressSnapshot(
    input.progress,
    input.generatedAt,
    input.localDate,
  )
  return Object.fromEntries(
    ABILITY_DOMAINS.map((domain) => {
      const state = input.progress.domains[domain]
      const metric = snapshot.domains[domain]
      let adjustment = 0
      if (
        state.recentPerformance >= 0.85 &&
        state.retentionScore >= 0.8
      ) {
        adjustment += 0.5
      }
      if (
        state.recentPerformance < 0.6 ||
        metric.trend === 'declining'
      ) {
        adjustment -= 0.5
      }
      if (state.assessmentStatus !== 'estimated') {
        adjustment -= 0.5
      }
      if (state.assessmentBoundary === 'lower-censored') {
        adjustment -= 0.5
      }
      return [domain, round(clamp(state.currentLevel + adjustment, 0, 12), 2)]
    }),
  ) as Readonly<Record<AbilityDomain, number>>
}

function taskSeedFromReview(
  item: ReviewItemState,
  mode: 'review' | 'retry',
  progress: ProgressState,
): TaskSeed {
  const durationEstimate = estimateTaskDuration({
    domain: item.domain,
    mode,
    tags: item.tags,
    legacyEstimatedSeconds: item.estimatedSeconds,
    progress,
  })
  return {
    learningUnitId: item.learningUnitId,
    contentRef: item.contentRef,
    domain: item.domain,
    mode,
    origin: mode === 'retry' ? 'retry' : 'due-review',
    difficultyLevel: item.difficultyLevel,
    estimatedSeconds: durationEstimate.estimateSeconds,
    durationEstimate,
    required: true,
    dueAt: mode === 'retry' ? item.retryAt : item.nextReviewAt,
    skipLimit: mode === 'retry' ? 0 : 1,
    tags: item.tags,
  }
}

function taskSeedFromCarryOver(
  task: LearningTask,
  progress: ProgressState,
): TaskSeed {
  const durationEstimate =
    task.durationEstimate ??
    estimateTaskDuration({
      domain: task.domain,
      mode: task.mode,
      tags: task.tags,
      legacyEstimatedSeconds: task.estimatedSeconds,
      progress,
    })
  return {
    learningUnitId: task.learningUnitId,
    contentRef: task.contentRef,
    domain: task.domain,
    mode: task.mode,
    origin: 'carry-over',
    difficultyLevel: task.difficultyLevel,
    estimatedSeconds: durationEstimate.estimateSeconds,
    durationEstimate,
    required: true,
    dueAt: task.dueAt,
    skipLimit: task.mode === 'retry' ? 0 : task.skipLimit,
    tags: task.tags,
  }
}

function prepareCandidate(
  candidate: LearningCandidate,
  progress: ProgressState,
): PreparedCandidate {
  const state = progress.domains[candidate.domain]
  const mode =
    state.assessmentStatus !== 'estimated' &&
    state.reliableEvidenceCount < 8 &&
    state.pendingCalibrationPolicy !== 'normal-training'
      ? 'calibration'
      : 'learn'
  return {
    candidate,
    mode,
    durationEstimate: estimateTaskDuration({
      domain: candidate.domain,
      mode,
      tags: candidate.tags,
      legacyEstimatedSeconds: candidate.estimatedSeconds,
      durationBaseline: candidate.durationBaseline,
      progress,
    }),
  }
}

function taskSeedFromCandidate(
  prepared: PreparedCandidate,
): TaskSeed {
  const { candidate, durationEstimate, mode } = prepared
  return {
    learningUnitId: candidate.learningUnitId,
    contentRef: candidate.contentRef,
    domain: candidate.domain,
    mode,
    origin: 'new',
    difficultyLevel: candidate.difficultyLevel,
    estimatedSeconds: durationEstimate.estimateSeconds,
    durationEstimate,
    required: false,
    dueAt: null,
    skipLimit: 2,
    tags: candidate.tags,
  }
}

function validateInput(input: DailyPlanInput): number {
  if (input.planId.trim().length === 0) {
    throw new TypeError('planId cannot be empty')
  }
  parseTimestamp(input.generatedAt, 'generatedAt')
  assertLocalDate(input.localDate)
  const budget = input.availableSeconds ?? DEFAULT_DAILY_TARGET_SECONDS
  if (
    !Number.isFinite(budget) ||
    budget < MINIMUM_DAILY_BUDGET_SECONDS ||
    budget > DEFAULT_DAILY_TARGET_SECONDS
  ) {
    throw new RangeError(
      `availableSeconds must be between ${MINIMUM_DAILY_BUDGET_SECONDS} and ${DEFAULT_DAILY_TARGET_SECONDS}`,
    )
  }
  const candidateIds = new Set<string>()
  for (const candidate of input.candidates) {
    if (candidate.schemaVersion !== 1) {
      throw new TypeError('Unsupported LearningCandidate schemaVersion')
    }
    if (candidateIds.has(candidate.learningUnitId)) {
      throw new TypeError(
        `Duplicate LearningCandidate: ${candidate.learningUnitId}`,
      )
    }
    candidateIds.add(candidate.learningUnitId)
    if (
      !Number.isFinite(candidate.difficultyLevel) ||
      candidate.difficultyLevel < 0 ||
      candidate.difficultyLevel > 12
    ) {
      throw new RangeError('candidate difficultyLevel must be between 0 and 12')
    }
    if (
      !Number.isFinite(candidate.estimatedSeconds) ||
      candidate.estimatedSeconds <= 0
    ) {
      throw new RangeError('candidate estimatedSeconds must be positive')
    }
  }
  return Math.round(budget)
}

function materializeTasks(
  planId: string,
  seeds: readonly TaskSeed[],
): readonly LearningTask[] {
  return seeds.map((seed, index) => ({
    schemaVersion: 1,
    taskId: `${planId}:task:${index + 1}`,
    planId,
    sequence: index + 1,
    learningUnitId: seed.learningUnitId,
    contentRef: seed.contentRef,
    domain: seed.domain,
    targetModuleId: seed.domain,
    mode: seed.mode,
    origin: seed.origin,
    difficultyLevel: seed.difficultyLevel,
    estimatedSeconds: seed.estimatedSeconds,
    durationEstimate: seed.durationEstimate,
    trainingBudget: {
      schemaVersion: 1,
      targetEffectiveSeconds: REQUIRED_TASK_EFFECTIVE_SECONDS,
    },
    required: seed.required,
    dueAt: seed.dueAt,
    skipLimit: seed.skipLimit,
    tags: seed.tags,
  }))
}

export function generateDailyPlan(input: DailyPlanInput): DailyPlan {
  validateInput(input)
  // `availableSeconds` was a legacy scheduling cap. Required daily streams
  // are now always three independent 15-minute effective-practice budgets.
  const budgetSeconds = DEFAULT_DAILY_TARGET_SECONDS
  const weaknessWeights = calculateWeaknessWeights(input.progress)
  const targetDifficulties = calculateTargetDifficulties(input)
  const targetByDomain = Object.fromEntries(
    ABILITY_DOMAINS.map((domain) => [
      domain,
      REQUIRED_TASK_EFFECTIVE_SECONDS,
    ]),
  ) as Readonly<Record<AbilityDomain, number>>
  const warnings: string[] = []
  if (input.availableSeconds !== undefined && input.availableSeconds !== budgetSeconds) {
    warnings.push('legacy-available-seconds-ignored')
  }

  const retrySeeds = Object.values(input.reviewItems)
    .filter((item) => isRetryDue(item, input.generatedAt))
    .sort((left, right) =>
      (left.retryAt as string).localeCompare(right.retryAt as string),
    )
    .map((item) => taskSeedFromReview(item, 'retry', input.progress))
  const carrySeeds = (input.carryOverTasks ?? [])
    .slice()
    .sort((left, right) => left.sequence - right.sequence)
    .map((task) => taskSeedFromCarryOver(task, input.progress))
  const dueReviewSeeds = Object.values(input.reviewItems)
    .filter(
      (item) =>
        item.retryAt === null &&
        isReviewDue(item, input.generatedAt),
    )
    .sort((left, right) =>
      left.nextReviewAt.localeCompare(right.nextReviewAt),
    )
    .map((item) => taskSeedFromReview(item, 'review', input.progress))

  const selectedSeeds: TaskSeed[] = []
  const plannedByDomain: Record<AbilityDomain, number> = {
    vocabulary: 0,
    listening: 0,
    speaking: 0,
  }

  const knownReviewIds = new Set(
    Object.values(input.reviewItems).map((item) => item.learningUnitId),
  )
  const newCandidates = input.candidates
    .filter(
      (candidate) => !knownReviewIds.has(candidate.learningUnitId),
    )
    .map((candidate) => prepareCandidate(candidate, input.progress))
  for (const domain of ABILITY_DOMAINS) {
    const priority = [...retrySeeds, ...carrySeeds, ...dueReviewSeeds].find(
      (seed) => seed.domain === domain,
    )
    const selected =
      priority ??
      newCandidates
        .filter(
          ({ candidate }) =>
            candidate.domain === domain && candidate.prerequisitesMet,
        )
        .map((prepared) => ({
          prepared,
          distance: Math.abs(
            prepared.candidate.difficultyLevel - targetDifficulties[domain],
          ),
        }))
        .sort(
          (left, right) =>
            left.distance - right.distance ||
            right.prepared.candidate.difficultyLevel -
              left.prepared.candidate.difficultyLevel ||
            left.prepared.candidate.learningUnitId.localeCompare(
              right.prepared.candidate.learningUnitId,
            ),
        )[0]?.prepared
    if (selected === undefined) {
      continue
    }
    const seed = 'candidate' in selected
      ? taskSeedFromCandidate(selected)
      : selected
    selectedSeeds.push(seed)
    plannedByDomain[domain] = seed.estimatedSeconds
  }

  // Retain the v1 reporting meaning: this is the sum of content estimates,
  // not the required stream completion budget (which lives on each task).
  const plannedSeconds = selectedSeeds.reduce(
    (total, seed) => total + seed.estimatedSeconds,
    0,
  )
  const unfilledSeconds = budgetSeconds - plannedSeconds
  if (unfilledSeconds > 0) {
    warnings.push('insufficient-eligible-content')
  }
  const tasks = materializeTasks(input.planId, selectedSeeds)
  const allocations = Object.fromEntries(
    ABILITY_DOMAINS.map((domain) => [
      domain,
      {
        domain,
        weaknessWeight: weaknessWeights[domain],
        targetDifficulty: targetDifficulties[domain],
        targetSeconds: targetByDomain[domain],
        plannedSeconds: plannedByDomain[domain],
      } satisfies DomainAllocation,
    ]),
  ) as Readonly<Record<AbilityDomain, DomainAllocation>>
  const status =
    tasks.length === 0
      ? 'empty'
      : unfilledSeconds > 0
        ? 'partial'
        : 'ready'

  return {
    schemaVersion: 1,
    planId: input.planId,
    localDate: input.localDate,
    generatedAt: input.generatedAt,
    targetSeconds: budgetSeconds,
    plannedSeconds,
    unfilledSeconds,
    status,
    tasks,
    allocations,
    warnings,
  }
}
