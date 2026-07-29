import type { NamespaceStore } from '../../storage/index.ts'
import { localStorageService } from '../../storage/index.ts'
import type { ExtraVocabularyTrainingSnapshot } from './extra-training.ts'

export const EXTRA_VOCABULARY_TRAINING_STORAGE_NAMESPACE =
  'feature.vocabulary.extra-training'

function isSnapshot(value: unknown): value is ExtraVocabularyTrainingSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Partial<ExtraVocabularyTrainingSnapshot>
  return snapshot.schemaVersion === 1 && typeof snapshot.updatedAt === 'string' &&
    typeof snapshot.session === 'object' && snapshot.session !== null &&
    snapshot.session.schemaVersion === 1 && typeof snapshot.session.sessionId === 'string' &&
    Array.isArray(snapshot.pendingEvents)
}

/** Stores only portable snapshots; runtime ports/functions never enter storage. */
export class ExtraVocabularyTrainingRepository {
  private readonly store: NamespaceStore
  constructor(
    store: NamespaceStore = localStorageService.namespace(
      EXTRA_VOCABULARY_TRAINING_STORAGE_NAMESPACE,
    ),
  ) { this.store = store }

  private key(sessionId: string): string { return `session:${sessionId}` }

  async load(sessionId: string): Promise<ExtraVocabularyTrainingSnapshot | undefined> {
    const record = await this.store.get<ExtraVocabularyTrainingSnapshot>(this.key(sessionId))
    if (!record || isSnapshot(record.value) && record.value.session.sessionId === sessionId) {
      return record?.value
    }
    await this.store.delete(this.key(sessionId))
    return undefined
  }

  async save(snapshot: ExtraVocabularyTrainingSnapshot): Promise<void> {
    const encoded = JSON.stringify(snapshot)
    if (encoded === undefined || !isSnapshot(JSON.parse(encoded))) {
      throw new TypeError('Extra vocabulary checkpoint must be JSON-portable.')
    }
    await this.store.put(this.key(snapshot.session.sessionId), JSON.parse(encoded), 1)
  }

  delete(sessionId: string): Promise<void> { return this.store.delete(this.key(sessionId)) }
}
