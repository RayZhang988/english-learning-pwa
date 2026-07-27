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

function targetSecondsByDomain(
  budgetSeconds: number,
  weights: Readonly<Record<AbilityDomain, number>>,
): Readonly<Record<AbilityDomain, number>> {
  const vocabulary = Math.floor(budgetSeconds * weights.vocabulary)
  const listening = Math.floor(budgetSeconds * weights.listening)
  return {
    vocabulary,
    listening,
    speaking: budgetSeconds - vocabulary - listening,
  }
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

function fitsBudget(
  plannedSeconds: number,
  estimatedSeconds: number,
  budgetSeconds: number,
): boolean {
  return plannedSeconds + estimatedSeconds <= budgetSeconds + 90
}

function selectNewSeed(
  candidates: readonly PreparedCandidate[],
  selectedIds: ReadonlySet<string>,
  plannedByDomain: Readonly<Record<AbilityDomain, number>>,
  targetByDomain: Readonly<Record<AbilityDomain, number>>,
  targetDifficulties: Readonly<Record<AbilityDomain, number>>,
  weaknessWeights: Readonly<Record<AbilityDomain, number>>,
  plannedSeconds: number,
  budgetSeconds: number,
): PreparedCandidate | undefined {
  return candidates
    .filter(
      ({ candidate, durationEstimate }) =>
        candidate.prerequisitesMet &&
        !selectedIds.has(candidate.learningUnitId) &&
        fitsBudget(
          plannedSeconds,
          durationEstimate.estimateSeconds,
          budgetSeconds,
        ),
    )
    .map((prepared) => {
      const { candidate } = prepared
      const deficit =
        targetByDomain[candidate.domain] -
        plannedByDomain[candidate.domain]
      const normalizedDeficit =
        deficit / Math.max(1, targetByDomain[candidate.domain])
      const difficultyDistance = Math.abs(
        candidate.difficultyLevel -
          targetDifficulties[candidate.domain],
      )
      const score =
        normalizedDeficit * 3 +
        weaknessWeights[candidate.domain] * 2 -
        difficultyDistance * 0.35
      return { prepared, score }
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.prepared.durationEstimate.estimateSeconds -
          right.prepared.durationEstimate.estimateSeconds ||
        left.prepared.candidate.learningUnitId.localeCompare(
          right.prepared.candidate.learningUnitId,
        ),
    )[0]?.prepared
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
    required: seed.required,
    dueAt: seed.dueAt,
    skipLimit: seed.skipLimit,
    tags: seed.tags,
  }))
}

export function generateDailyPlan(input: DailyPlanInput): DailyPlan {
  const budgetSeconds = validateInput(input)
  const weaknessWeights = calculateWeaknessWeights(input.progress)
  const targetDifficulties = calculateTargetDifficulties(input)
  const targetByDomain = targetSecondsByDomain(
    budgetSeconds,
    weaknessWeights,
  )
  const warnings: string[] = []
  if (budgetSeconds < DEFAULT_DAILY_TARGET_SECONDS) {
    warnings.push('short-day-budget')
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

  const mandatoryCap = Math.round(
    budgetSeconds * (budgetSeconds <= 15 * 60 ? 0.75 : 0.55),
  )
  const selectedSeeds: TaskSeed[] = []
  const selectedIds = new Set<string>()
  let plannedSeconds = 0
  const plannedByDomain: Record<AbilityDomain, number> = {
    vocabulary: 0,
    listening: 0,
    speaking: 0,
  }

  for (const seed of [...retrySeeds, ...carrySeeds, ...dueReviewSeeds]) {
    if (selectedIds.has(seed.learningUnitId)) {
      continue
    }
    const isStrictPriority = seed.mode === 'retry'
    if (
      !fitsBudget(plannedSeconds, seed.estimatedSeconds, budgetSeconds) ||
      (!isStrictPriority &&
        plannedSeconds + seed.estimatedSeconds > mandatoryCap)
    ) {
      continue
    }
    selectedSeeds.push(seed)
    selectedIds.add(seed.learningUnitId)
    plannedSeconds += seed.estimatedSeconds
    plannedByDomain[seed.domain] += seed.estimatedSeconds
  }

  const mandatoryCount = new Set(
    [...retrySeeds, ...carrySeeds, ...dueReviewSeeds].map(
      (seed) => seed.learningUnitId,
    ),
  ).size
  if (selectedSeeds.length < mandatoryCount) {
    warnings.push('review-or-carry-over-backlog-truncated')
  }

  const knownReviewIds = new Set(
    Object.values(input.reviewItems).map((item) => item.learningUnitId),
  )
  const newCandidates = input.candidates
    .filter(
      (candidate) => !knownReviewIds.has(candidate.learningUnitId),
    )
    .map((candidate) => prepareCandidate(candidate, input.progress))
  while (plannedSeconds < budgetSeconds) {
    const next = selectNewSeed(
      newCandidates,
      selectedIds,
      plannedByDomain,
      targetByDomain,
      targetDifficulties,
      weaknessWeights,
      plannedSeconds,
      budgetSeconds,
    )
    if (next === undefined) {
      break
    }
    const seed = taskSeedFromCandidate(next)
    selectedSeeds.push(seed)
    selectedIds.add(seed.learningUnitId)
    plannedSeconds += seed.estimatedSeconds
    plannedByDomain[seed.domain] += seed.estimatedSeconds
  }

  const unfilledSeconds = Math.max(0, budgetSeconds - plannedSeconds)
  if (unfilledSeconds > 90) {
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
      : unfilledSeconds > 90
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
