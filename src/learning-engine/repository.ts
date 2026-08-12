import type { NamespaceStore } from '../storage/index.ts'
import type { LearningEngineState } from './contracts.ts'
import { assertGrowthState } from './growth.ts'

export const LEARNING_ENGINE_STORAGE_NAMESPACE = 'learning.engine'
export const LEARNING_ENGINE_STORAGE_SCHEMA_VERSION = 1
export const LEARNING_ENGINE_STATE_KEY = 'current-state'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasValidTrainingScore(value: unknown): boolean {
  if (value === undefined) {
    return true
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return false
  }
  const score = value as Record<string, unknown>
  return score.schemaVersion === 1 &&
    ['correctCount', 'incorrectCount', 'unscorableCount'].every(
      (key) =>
        typeof score[key] === 'number' &&
        Number.isInteger(score[key]) &&
        (score[key] as number) >= 0,
    )
}

function hasValidDurationSamples(progress: Record<string, unknown>): boolean {
  if (!('durationSamples' in progress)) {
    return true
  }
  if (!Array.isArray(progress.durationSamples)) {
    return false
  }
  return progress.durationSamples.every((sample) => {
    if (
      typeof sample !== 'object' ||
      sample === null ||
      !('sampleId' in sample) ||
      typeof sample.sampleId !== 'string' ||
      sample.sampleId.trim().length === 0 ||
      !('taskId' in sample) ||
      typeof sample.taskId !== 'string' ||
      sample.taskId.trim().length === 0 ||
      !('learningUnitId' in sample) ||
      typeof sample.learningUnitId !== 'string' ||
      sample.learningUnitId.trim().length === 0 ||
      !('domain' in sample) ||
      (sample.domain !== 'vocabulary' &&
        sample.domain !== 'listening' &&
        sample.domain !== 'speaking') ||
      !('mode' in sample) ||
      (sample.mode !== 'learn' &&
        sample.mode !== 'calibration' &&
        sample.mode !== 'review' &&
        sample.mode !== 'retry') ||
      !('contentType' in sample) ||
      typeof sample.contentType !== 'string' ||
      sample.contentType.trim().length === 0 ||
      !('profileKey' in sample) ||
      typeof sample.profileKey !== 'string' ||
      sample.profileKey.trim().length === 0 ||
      !('effectiveSeconds' in sample) ||
      typeof sample.effectiveSeconds !== 'number' ||
      !Number.isFinite(sample.effectiveSeconds) ||
      sample.effectiveSeconds <= 0 ||
      !('source' in sample) ||
      sample.source !== 'timing-segments' ||
      !('reliable' in sample) ||
      typeof sample.reliable !== 'boolean' ||
      !('completedAt' in sample) ||
      typeof sample.completedAt !== 'string'
    ) {
      return false
    }
    if (
      sample.profileKey !==
      `${sample.domain}|${sample.mode}|${sample.contentType}`
    ) {
      return false
    }
    return Number.isFinite(Date.parse(sample.completedAt))
  })
}

function hasValidExtraTraining(value: Record<string, unknown>): boolean {
  if (!('extraTraining' in value)) {
    return true
  }
  const extra = value.extraTraining
  if (
    typeof extra !== 'object' || extra === null ||
    !('schemaVersion' in extra) || extra.schemaVersion !== 1 ||
    !('sessions' in extra) || typeof extra.sessions !== 'object' || extra.sessions === null ||
    !('processedEventIds' in extra) || !Array.isArray(extra.processedEventIds) ||
    extra.processedEventIds.some((id) => typeof id !== 'string')
  ) {
    return false
  }
  const priorityGroups = [
    'recent-error',
    'due-review',
    'same-day-variant',
    'new-optional-content',
  ]
  return Object.entries(extra.sessions).every(([sessionId, session]) => {
    if (typeof session !== 'object' || session === null) return false
    const record = session as Record<string, unknown>
    const priorityItemIds = record.priorityItemIds
    const priorityRecord = priorityItemIds as Record<string, unknown>
    const validPriorityItemIds =
      priorityItemIds === undefined || (
        typeof priorityItemIds === 'object' && priorityItemIds !== null && !Array.isArray(priorityItemIds) &&
        Object.keys(priorityItemIds).length === priorityGroups.length &&
        priorityGroups.every((group) =>
          Array.isArray(priorityRecord[group]) &&
          (priorityRecord[group] as unknown[]).every((itemId: unknown) =>
            typeof itemId === 'string' && itemId.trim().length > 0,
          ),
        )
      )
    const openEnded =
      record.completionMode === 'open-ended' &&
      typeof record.effectiveSeconds === 'number' &&
      Number.isFinite(record.effectiveSeconds) &&
      record.effectiveSeconds >= 0 &&
      record.targetEffectiveSeconds === undefined &&
      record.remainingEffectiveSeconds === undefined &&
      ['running', 'paused', 'failed', 'expired'].includes(
        record.status as string,
      )
    const legacyBudget =
      record.completionMode === undefined &&
      record.targetEffectiveSeconds === 900 &&
      typeof record.remainingEffectiveSeconds === 'number' &&
      Number.isFinite(record.remainingEffectiveSeconds) &&
      record.remainingEffectiveSeconds >= 0 &&
      record.remainingEffectiveSeconds <= 900 &&
      ['running', 'finish-current-item', 'paused', 'completed', 'failed', 'expired'].includes(
        record.status as string,
      )
    return validPriorityItemIds && (
      record.schemaVersion === 1 && record.sessionId === sessionId &&
      typeof record.localDate === 'string' && Number.isFinite(Date.parse(`${record.localDate}T00:00:00Z`)) &&
      (record.domain === 'vocabulary' || record.domain === 'listening' || record.domain === 'speaking') &&
      record.targetModuleId === record.domain && record.mode === 'learn' &&
      (openEnded || legacyBudget) &&
      (record.nextSupplyCursor === null || typeof record.nextSupplyCursor === 'string') &&
      Array.isArray(record.excludeItemIds) && record.excludeItemIds.every((id) => typeof id === 'string') &&
      typeof record.completedItemCount === 'number' && Number.isInteger(record.completedItemCount) && record.completedItemCount >= 0 &&
      hasValidTrainingScore(record.score) &&
      typeof record.startedAt === 'string' && Number.isFinite(Date.parse(record.startedAt)) &&
      typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt)) &&
      (record.endedAt === null || (typeof record.endedAt === 'string' && Number.isFinite(Date.parse(record.endedAt))))
    )
  })
}

function assertLearningEngineState(
  value: unknown,
): asserts value is LearningEngineState {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('progress' in value) ||
    typeof value.progress !== 'object' ||
    value.progress === null ||
    !('schemaVersion' in value.progress) ||
    value.progress.schemaVersion !== 1 ||
    !('profileId' in value.progress) ||
    typeof value.progress.profileId !== 'string' ||
    !('domains' in value.progress) ||
    typeof value.progress.domains !== 'object' ||
    value.progress.domains === null ||
    !hasValidDurationSamples(
      value.progress as Record<string, unknown>,
    ) ||
    !hasValidExtraTraining(value as Record<string, unknown>) ||
    !('reviewItems' in value) ||
    typeof value.reviewItems !== 'object' ||
    value.reviewItems === null
  ) {
    throw new TypeError('Stored learning engine state is invalid')
  }
  const recent = (value as Record<string, unknown>).recentTrainingItemIds
  if (
    recent !== undefined &&
    (!isRecord(recent) ||
      Object.entries(recent).some(([bucket, ids]) =>
        bucket.trim().length === 0 ||
        !Array.isArray(ids) ||
        ids.length > 12 ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string' || id.trim().length === 0),
      ))
  ) {
    throw new TypeError('recentTrainingItemIds is invalid')
  }
  const sceneAcknowledgements =
    (value as Record<string, unknown>).sceneTrainingAcknowledgementIds
  if (
    sceneAcknowledgements !== undefined &&
    (!Array.isArray(sceneAcknowledgements) ||
      sceneAcknowledgements.length > 500 ||
      new Set(sceneAcknowledgements).size !== sceneAcknowledgements.length ||
      sceneAcknowledgements.some(
        (id) => typeof id !== 'string' || id.trim().length === 0,
      ))
  ) {
    throw new TypeError('sceneTrainingAcknowledgementIds is invalid')
  }
  const growth = (value as Record<string, unknown>).growth
  if (growth !== undefined) {
    assertGrowthState(growth)
  }
}

export class LearningEngineRepository {
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async save(state: LearningEngineState): Promise<void> {
    await this.#store.put(
      LEARNING_ENGINE_STATE_KEY,
      state,
      LEARNING_ENGINE_STORAGE_SCHEMA_VERSION,
    )
  }

  async load(): Promise<LearningEngineState | undefined> {
    const record = await this.#store.get<unknown>(
      LEARNING_ENGINE_STATE_KEY,
    )
    if (record === undefined) {
      return undefined
    }
    if (
      record.schemaVersion !==
      LEARNING_ENGINE_STORAGE_SCHEMA_VERSION
    ) {
      throw new TypeError(
        `Unsupported learning engine state version: ${record.schemaVersion}`,
      )
    }
    assertLearningEngineState(record.value)
    return record.value
  }

  async clear(): Promise<void> {
    await this.#store.delete(LEARNING_ENGINE_STATE_KEY)
  }
}
