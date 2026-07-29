import type { NamespaceStore } from '../../storage/index.ts'
import { localStorageService } from '../../storage/index.ts'
import type { ExtraListeningTrainingSnapshot } from './extra-training.ts'

export const EXTRA_LISTENING_TRAINING_STORAGE_NAMESPACE =
  'feature.listening.extra-training'

function isSnapshot(value: unknown): value is ExtraListeningTrainingSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Partial<ExtraListeningTrainingSnapshot>
  return snapshot.schemaVersion === 1 && typeof snapshot.updatedAt === 'string' &&
    typeof snapshot.session === 'object' && snapshot.session !== null &&
    snapshot.session.schemaVersion === 1 &&
    typeof snapshot.session.sessionId === 'string' &&
    Array.isArray(snapshot.pendingEvents)
}

/** Portable checkpoint and outbox for an optional listening block, never a plan task. */
export class ExtraListeningTrainingRepository {
  private readonly store: NamespaceStore
  constructor(store: NamespaceStore = localStorageService.namespace(
    EXTRA_LISTENING_TRAINING_STORAGE_NAMESPACE,
  )) { this.store = store }
  private key(sessionId: string) { return `session:${sessionId}` }
  async load(sessionId: string): Promise<ExtraListeningTrainingSnapshot | undefined> {
    const record = await this.store.get<ExtraListeningTrainingSnapshot>(this.key(sessionId))
    if (!record || isSnapshot(record.value) && record.value.session.sessionId === sessionId) return record?.value
    await this.store.delete(this.key(sessionId))
    return undefined
  }
  async save(snapshot: ExtraListeningTrainingSnapshot): Promise<void> {
    const encoded = JSON.stringify(snapshot)
    if (encoded === undefined || !isSnapshot(JSON.parse(encoded))) {
      throw new TypeError('Extra listening checkpoint must be JSON-portable.')
    }
    await this.store.put(this.key(snapshot.session.sessionId), JSON.parse(encoded), 1)
  }
  delete(sessionId: string) { return this.store.delete(this.key(sessionId)) }
}
