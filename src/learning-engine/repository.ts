import type { NamespaceStore } from '../storage/index.ts'
import type { LearningEngineState } from './contracts.ts'

export const LEARNING_ENGINE_STORAGE_NAMESPACE = 'learning.engine'
export const LEARNING_ENGINE_STORAGE_SCHEMA_VERSION = 1
export const LEARNING_ENGINE_STATE_KEY = 'current-state'

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
    !('reviewItems' in value) ||
    typeof value.reviewItems !== 'object' ||
    value.reviewItems === null
  ) {
    throw new TypeError('Stored learning engine state is invalid')
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
