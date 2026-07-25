import { AppError } from '../../core/index.ts'
import {
  ASSESSMENT_RUNTIME_SCHEMA_VERSION,
  ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
  parseAssessmentRuntimeSnapshot,
  placementBankV1,
  type AssessmentBank,
  type AssessmentRuntimeSnapshotV1,
} from '../../features/assessment/index.ts'
import type { NamespaceStore } from '../../storage/index.ts'

export class AssessmentRuntimeSnapshotRepository {
  readonly #store: NamespaceStore
  readonly #bank: AssessmentBank

  constructor(
    store: NamespaceStore,
    bank: AssessmentBank = placementBankV1,
  ) {
    this.#store = store
    this.#bank = bank
  }

  async save(snapshot: AssessmentRuntimeSnapshotV1): Promise<void> {
    const validated = parseAssessmentRuntimeSnapshot(
      snapshot,
      this.#bank,
    )
    await this.#store.put(
      ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
      validated,
      ASSESSMENT_RUNTIME_SCHEMA_VERSION,
    )
  }

  async load(): Promise<AssessmentRuntimeSnapshotV1 | undefined> {
    const record = await this.#store.get<unknown>(
      ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
    )
    if (!record) {
      return undefined
    }
    if (record.schemaVersion !== ASSESSMENT_RUNTIME_SCHEMA_VERSION) {
      throw new AppError(
        'schema_incompatible',
        `不支持的水平测试快照版本：${record.schemaVersion}。`,
        {
          recoverable: false,
          details: {
            namespace: 'feature.assessment',
            key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
          },
        },
      )
    }
    try {
      return parseAssessmentRuntimeSnapshot(
        record.value,
        this.#bank,
      )
    } catch (error) {
      throw new AppError(
        'schema_incompatible',
        '本地水平测试快照已损坏，不能安全恢复。',
        {
          cause: error,
          recoverable: false,
          details: {
            namespace: 'feature.assessment',
            key: ASSESSMENT_RUNTIME_SNAPSHOT_KEY,
          },
        },
      )
    }
  }

  async clear(): Promise<void> {
    await this.#store.delete(ASSESSMENT_RUNTIME_SNAPSHOT_KEY)
  }
}
