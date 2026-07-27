import { AppError } from '../../core/index.ts'
import {
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  TRAVEL_VOCABULARY_RUNTIME_SCHEMA_VERSION_R1,
  TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
  VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  type TravelVocabularyAssessmentRuntimeSnapshotR1,
} from '../../features/assessment/index.ts'
import type { NamespaceStore } from '../../storage/index.ts'

export const TRAVEL_VOCABULARY_CORRUPT_BACKUP_PREFIX_R1 =
  'corrupt-travel-vocabulary-assessment-r1-v1'

export type TravelVocabularyAssessmentSnapshotSourceR1 =
  | {
      readonly kind: 'r1'
      readonly key: typeof TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1
      readonly snapshot: unknown
    }
  | {
      readonly kind: 'legacy-v2'
      readonly key: typeof VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY
      readonly snapshot: unknown
    }
  | {
      readonly kind: 'legacy-v1'
      readonly key: typeof ASSESSMENT_RUNTIME_SNAPSHOT_KEY
      readonly snapshot: unknown
    }

const sourceOrder = [
  {
    kind: 'r1',
    key: TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
    schemaVersion: TRAVEL_VOCABULARY_RUNTIME_SCHEMA_VERSION_R1,
  },
  {
    kind: 'legacy-v2',
    key: VOCABULARY_ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
    schemaVersion: 2,
  },
  {
    kind: 'legacy-v1',
    key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
    schemaVersion: 1,
  },
] as const

function incompatibleRecord(
  key: string,
  message: string,
  cause?: unknown,
): AppError {
  return new AppError('schema_incompatible', message, {
    cause,
    recoverable: true,
    details: {
      namespace: 'feature.assessment',
      key,
      recovery: 'preserve-and-start-r1',
    },
  })
}

export class TravelVocabularyR1SnapshotRepository {
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async load(): Promise<
    TravelVocabularyAssessmentSnapshotSourceR1 | undefined
  > {
    for (const source of sourceOrder) {
      const record = await this.#store.get<unknown>(source.key)
      if (!record) {
        continue
      }
      if (record.schemaVersion !== source.schemaVersion) {
        throw incompatibleRecord(
          source.key,
          `本地水平测试记录版本不匹配：${source.key} 使用版本 ${record.schemaVersion}。`,
        )
      }
      if (source.kind === 'r1') {
        return {
          kind: source.kind,
          key: source.key,
          snapshot: structuredClone(record.value),
        }
      }
      if (source.kind === 'legacy-v2') {
        return {
          kind: source.kind,
          key: source.key,
          snapshot: structuredClone(record.value),
        }
      }
      return {
        kind: source.kind,
        key: source.key,
        snapshot: structuredClone(record.value),
      }
    }
    return undefined
  }

  async save(
    snapshot: TravelVocabularyAssessmentRuntimeSnapshotR1,
  ): Promise<void> {
    await this.#store.put(
      TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1,
      structuredClone(snapshot),
      TRAVEL_VOCABULARY_RUNTIME_SCHEMA_VERSION_R1,
    )
  }

  async preserveSourceAndSaveFresh(
    snapshot: TravelVocabularyAssessmentRuntimeSnapshotR1,
    sourceKey: string,
    archiveId: string,
  ): Promise<void> {
    if (sourceKey === TRAVEL_VOCABULARY_RUNTIME_SNAPSHOT_KEY_R1) {
      const current = await this.#store.get<unknown>(sourceKey)
      if (current) {
        await this.#store.put(
          `${TRAVEL_VOCABULARY_CORRUPT_BACKUP_PREFIX_R1}:${archiveId}`,
          current.value,
          current.schemaVersion,
        )
      }
    }
    await this.save(snapshot)
  }
}
