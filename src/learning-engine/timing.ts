import type {
  AbilityDomain,
  LearningAttemptCompletedEvent,
  LearningTaskMode,
  LearningTimingSegmentRecordedPayload,
  PlanProgress,
  ProgressState,
  TaskDurationBaseline,
  TaskDurationEstimate,
  TaskDurationSample,
} from './contracts.ts'
import {
  MAX_CONTINUOUS_ACTIVE_MEDIA_SECONDS,
  MAX_INTERACTION_IDLE_SECONDS,
  MAX_RELIABLE_EFFECTIVE_SECONDS,
  MIN_PERSONAL_DURATION_SAMPLE_COUNT,
  MIN_RELIABLE_EFFECTIVE_SECONDS,
  PERSONAL_DURATION_SAMPLE_WINDOW,
} from './contracts.ts'
import { clamp, parseTimestamp } from './utils.ts'

const MAX_DURATION_SAMPLE_HISTORY = 90
const CONTENT_TYPE_TAG_PREFIX = 'content-type:'

const ACTIVE_REASON_PHASE = {
  'active-answering': 'answering',
  'active-audio-listening': 'audio-listening',
  'active-recording': 'recording',
  'active-playback': 'playback',
  'active-feedback': 'feedback',
} as const

const EXCLUDED_REASON_PHASE = {
  'app-backgrounded': null,
  'user-paused': 'paused',
  'idle-timeout': 'idle',
  'content-loading': 'loading',
  'permission-wait': 'permission-wait',
  'network-wait': 'network-wait',
  'media-loading': 'loading',
} as const

export interface TimingSegmentClassification {
  readonly included: boolean
  readonly effectiveSeconds: number
  readonly excludedSeconds: number
}

export interface EstimateTaskDurationInput {
  readonly domain: AbilityDomain
  readonly mode: LearningTaskMode
  readonly tags: readonly string[]
  readonly legacyEstimatedSeconds: number
  readonly durationBaseline?: TaskDurationBaseline
  readonly progress: ProgressState
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`)
  }
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`)
  }
}

function assertCount(value: number, label: string): void {
  assertFiniteNonNegative(value, label)
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer`)
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('median requires at least one value')
  }
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle]
}

function durationContentType(
  tags: readonly string[],
  baseline?: TaskDurationBaseline,
): string {
  if (baseline !== undefined) {
    return baseline.contentType
  }
  const tagged = tags.find((tag) => tag.startsWith(CONTENT_TYPE_TAG_PREFIX))
  const value = tagged?.slice(CONTENT_TYPE_TAG_PREFIX.length).trim()
  return value && value.length > 0 ? value : 'general'
}

export function getDurationProfileKey(
  domain: AbilityDomain,
  mode: LearningTaskMode,
  contentType: string,
): string {
  const normalized = contentType.trim()
  if (normalized.length === 0 || normalized.includes('|')) {
    throw new TypeError(
      'duration contentType must be non-empty and cannot contain "|"',
    )
  }
  return `${domain}|${mode}|${normalized}`
}

function validateDurationBaseline(
  baseline: TaskDurationBaseline,
): void {
  if (baseline.schemaVersion !== 1) {
    throw new TypeError('Unsupported TaskDurationBaseline schemaVersion')
  }
  getDurationProfileKey('vocabulary', 'learn', baseline.contentType)
  assertFiniteNonNegative(baseline.fixedSeconds, 'fixedSeconds')
  assertCount(baseline.itemCount, 'itemCount')
  assertFiniteNonNegative(baseline.secondsPerItem, 'secondsPerItem')
  assertFiniteNonNegative(
    baseline.activeAudioSeconds,
    'activeAudioSeconds',
  )
  assertFiniteNonNegative(
    baseline.expectedAudioPlaythroughs,
    'expectedAudioPlaythroughs',
  )
  assertCount(baseline.interactionStepCount, 'interactionStepCount')
  assertFiniteNonNegative(
    baseline.secondsPerInteractionStep,
    'secondsPerInteractionStep',
  )
  assertFinitePositive(baseline.minimumSeconds, 'minimumSeconds')
  assertFinitePositive(baseline.maximumSeconds, 'maximumSeconds')
  if (baseline.maximumSeconds < baseline.minimumSeconds) {
    throw new RangeError(
      'maximumSeconds must be greater than or equal to minimumSeconds',
    )
  }
}

export function calculateContentBaselineSeconds(
  baseline: TaskDurationBaseline,
): number {
  validateDurationBaseline(baseline)
  const rawSeconds =
    baseline.fixedSeconds +
    baseline.itemCount * baseline.secondsPerItem +
    baseline.activeAudioSeconds *
      baseline.expectedAudioPlaythroughs +
    baseline.interactionStepCount *
      baseline.secondsPerInteractionStep
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) {
    throw new RangeError(
      'TaskDurationBaseline must produce a positive duration',
    )
  }
  return Math.round(
    clamp(
      rawSeconds,
      baseline.minimumSeconds,
      baseline.maximumSeconds,
    ),
  )
}

interface HistoricalDuration {
  readonly id: string
  readonly effectiveSeconds: number
  readonly completedAt: string
}

function trustedHistoricalDurations(
  progress: ProgressState,
  profileKey: string,
): readonly HistoricalDuration[] {
  const samples = new Map<string, HistoricalDuration>()
  for (const sample of progress.durationSamples ?? []) {
    if (
      sample.profileKey === profileKey &&
      sample.source === 'timing-segments' &&
      sample.reliable &&
      Number.isFinite(sample.effectiveSeconds) &&
      sample.effectiveSeconds >= MIN_RELIABLE_EFFECTIVE_SECONDS &&
      sample.effectiveSeconds <= MAX_RELIABLE_EFFECTIVE_SECONDS
    ) {
      samples.set(sample.sampleId, {
        id: sample.sampleId,
        effectiveSeconds: sample.effectiveSeconds,
        completedAt: sample.completedAt,
      })
    }
  }
  return [...samples.values()]
    .sort(
      (left, right) =>
        right.completedAt.localeCompare(left.completedAt) ||
        right.id.localeCompare(left.id),
    )
    .slice(0, PERSONAL_DURATION_SAMPLE_WINDOW)
}

function withoutExtremeOutliers(
  samples: readonly HistoricalDuration[],
): readonly HistoricalDuration[] {
  if (samples.length < 4) {
    return samples
  }
  const center = median(samples.map((sample) => sample.effectiveSeconds))
  const absoluteDeviations = samples.map((sample) =>
    Math.abs(sample.effectiveSeconds - center),
  )
  const medianAbsoluteDeviation = median(absoluteDeviations)
  const tolerance =
    medianAbsoluteDeviation === 0
      ? Math.max(15, center * 0.25)
      : 3 * 1.4826 * medianAbsoluteDeviation
  const filtered = samples.filter(
    (sample) =>
      Math.abs(sample.effectiveSeconds - center) <= tolerance,
  )
  return filtered.length >= MIN_PERSONAL_DURATION_SAMPLE_COUNT
    ? filtered
    : samples
}

function contentEstimate(
  input: EstimateTaskDurationInput,
  contentType: string,
  profileKey: string,
): TaskDurationEstimate {
  if (input.durationBaseline !== undefined) {
    const estimateSeconds = calculateContentBaselineSeconds(
      input.durationBaseline,
    )
    return {
      schemaVersion: 1,
      estimateSeconds,
      sampleCount: 0,
      basis: 'content-baseline',
      confidence: 'medium',
      contentType,
      reasonableRangeSeconds: {
        lower: Math.round(input.durationBaseline.minimumSeconds),
        upper: Math.round(input.durationBaseline.maximumSeconds),
      },
      profileKey,
      baselineSource: 'structured-content',
    }
  }

  assertFinitePositive(
    input.legacyEstimatedSeconds,
    'legacyEstimatedSeconds',
  )
  const estimateSeconds = Math.round(input.legacyEstimatedSeconds)
  return {
    schemaVersion: 1,
    estimateSeconds,
    sampleCount: 0,
    basis: 'content-baseline',
    confidence: 'low',
    contentType,
    reasonableRangeSeconds: {
      lower: Math.max(1, Math.round(estimateSeconds * 0.5)),
      upper: Math.round(estimateSeconds * 1.5),
    },
    profileKey,
    baselineSource: 'legacy-content-estimate',
  }
}

export function estimateTaskDuration(
  input: EstimateTaskDurationInput,
): TaskDurationEstimate {
  const contentType = durationContentType(
    input.tags,
    input.durationBaseline,
  )
  const profileKey = getDurationProfileKey(
    input.domain,
    input.mode,
    contentType,
  )
  const baseline = contentEstimate(input, contentType, profileKey)
  const samples = withoutExtremeOutliers(
    trustedHistoricalDurations(input.progress, profileKey),
  )
  if (samples.length < MIN_PERSONAL_DURATION_SAMPLE_COUNT) {
    return {
      ...baseline,
      sampleCount: samples.length,
    }
  }

  const values = samples.map((sample) => sample.effectiveSeconds)
  const estimateSeconds = Math.round(median(values))
  const ordered = [...values].sort((left, right) => left - right)
  const lowerObserved = ordered[0]
  const upperObserved = ordered.at(-1) as number
  return {
    schemaVersion: 1,
    estimateSeconds,
    sampleCount: samples.length,
    basis: 'personal-history',
    confidence: samples.length >= 5 ? 'high' : 'medium',
    contentType,
    reasonableRangeSeconds: {
      lower: Math.max(1, Math.round(lowerObserved * 0.9)),
      upper: Math.round(upperObserved * 1.1),
    },
    profileKey,
    baselineSource: baseline.baselineSource,
  }
}

function segmentElapsedSeconds(
  payload: LearningTimingSegmentRecordedPayload,
): number {
  parseTimestamp(payload.startedAt, 'startedAt')
  parseTimestamp(payload.endedAt, 'endedAt')
  if (
    !Number.isFinite(payload.elapsedSeconds) ||
    !Number.isInteger(payload.elapsedSeconds) ||
    payload.elapsedSeconds <= 0
  ) {
    throw new RangeError('elapsedSeconds must be a positive integer')
  }
  const wallSeconds =
    (Date.parse(payload.endedAt) - Date.parse(payload.startedAt)) / 1_000
  if (
    wallSeconds <= 0 ||
    Math.abs(wallSeconds - payload.elapsedSeconds) > 1
  ) {
    throw new RangeError(
      'elapsedSeconds must match the timing segment timestamps',
    )
  }
  if (payload.idleThresholdSeconds !== MAX_INTERACTION_IDLE_SECONDS) {
    throw new TypeError(
      `idleThresholdSeconds must be ${MAX_INTERACTION_IDLE_SECONDS}`,
    )
  }
  return payload.elapsedSeconds
}

export function classifyTimingSegment(
  payload: LearningTimingSegmentRecordedPayload,
): TimingSegmentClassification {
  const elapsedSeconds = segmentElapsedSeconds(payload)
  const activePhase =
    ACTIVE_REASON_PHASE[
      payload.reason as keyof typeof ACTIVE_REASON_PHASE
    ]
  if (activePhase !== undefined) {
    if (
      payload.visibility !== 'foreground' ||
      payload.phase !== activePhase
    ) {
      throw new TypeError(
        'active timing reasons require a matching foreground phase',
      )
    }
    const maximum =
      payload.phase === 'answering' || payload.phase === 'feedback'
        ? MAX_INTERACTION_IDLE_SECONDS
        : MAX_CONTINUOUS_ACTIVE_MEDIA_SECONDS
    if (elapsedSeconds > maximum) {
      throw new RangeError(
        `active ${payload.phase} segment exceeds its maximum duration`,
      )
    }
    return {
      included: true,
      effectiveSeconds: elapsedSeconds,
      excludedSeconds: 0,
    }
  }

  const excludedPhase =
    EXCLUDED_REASON_PHASE[
      payload.reason as keyof typeof EXCLUDED_REASON_PHASE
    ]
  if (excludedPhase === undefined) {
    throw new TypeError('Unsupported timing segment reason')
  }
  if (
    payload.reason === 'app-backgrounded'
      ? payload.visibility !== 'background'
      : excludedPhase !== null && payload.phase !== excludedPhase
  ) {
    throw new TypeError(
      'excluded timing reason does not match visibility or phase',
    )
  }
  if (elapsedSeconds > MAX_RELIABLE_EFFECTIVE_SECONDS) {
    throw new RangeError('excluded timing segment is unreasonably long')
  }
  return {
    included: false,
    effectiveSeconds: 0,
    excludedSeconds: elapsedSeconds,
  }
}

export function recordTaskDurationSample(
  progress: ProgressState,
  planProgress: PlanProgress,
  event: LearningAttemptCompletedEvent,
): ProgressState {
  if (
    (progress.durationSamples ?? []).some(
      (sample) => sample.sampleId === event.id,
    )
  ) {
    return progress
  }
  const execution = planProgress.tasks.find(
    (entry) => entry.task.taskId === event.payload.taskId,
  )
  if (
    execution !== undefined &&
    (execution.task.learningUnitId !== event.payload.learningUnitId ||
      execution.task.contentRef !== event.payload.contentRef ||
      execution.task.domain !== event.payload.domain ||
      execution.task.targetModuleId !==
        event.payload.targetModuleId ||
      execution.task.mode !== event.payload.mode)
  ) {
    throw new TypeError(
      'Duration sample event identity does not match plan task',
    )
  }
  if (
    execution === undefined ||
    execution.status !== 'completed' ||
    execution.effectiveTimeSource !== 'timing-segments' ||
    (execution.timingSegmentCount ?? 0) === 0
  ) {
    return progress
  }
  const effectiveSeconds = execution.effectiveSeconds
  if (
    !Number.isFinite(effectiveSeconds) ||
    effectiveSeconds < MIN_RELIABLE_EFFECTIVE_SECONDS ||
    effectiveSeconds > MAX_RELIABLE_EFFECTIVE_SECONDS
  ) {
    return progress
  }
  const durationEstimate = execution.task.durationEstimate
  const contentType =
    durationEstimate?.contentType ??
    durationContentType(execution.task.tags)
  const profileKey =
    durationEstimate?.profileKey ??
    getDurationProfileKey(
      execution.task.domain,
      execution.task.mode,
      contentType,
    )
  const sample: TaskDurationSample = {
    sampleId: event.id,
    taskId: execution.task.taskId,
    learningUnitId: execution.task.learningUnitId,
    domain: execution.task.domain,
    mode: execution.task.mode,
    contentType,
    profileKey,
    effectiveSeconds,
    source: 'timing-segments',
    reliable: true,
    completedAt: event.occurredAt,
  }
  return {
    ...progress,
    updatedAt: event.occurredAt,
    durationSamples: [
      ...(progress.durationSamples ?? []),
      sample,
    ].slice(-MAX_DURATION_SAMPLE_HISTORY),
  }
}
