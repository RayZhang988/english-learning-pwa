import type { NamespaceStore } from '../storage/index.ts'
import type { LearningEngineState } from './contracts.ts'

export const LEARNING_ENGINE_STORAGE_NAMESPACE = 'learning.engine'
export const LEARNING_ENGINE_STORAGE_SCHEMA_VERSION = 1
export const LEARNING_ENGINE_STATE_KEY = 'current-state'

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
