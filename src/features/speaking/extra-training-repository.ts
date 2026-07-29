import type { NamespaceStore } from '../../storage/index.ts'
import { localStorageService } from '../../storage/index.ts'
import type { ExtraSpeakingTrainingSnapshot } from './extra-training.ts'

export const EXTRA_SPEAKING_TRAINING_STORAGE_NAMESPACE =
  'feature.speaking.extra-training'

function valid(value: unknown): value is ExtraSpeakingTrainingSnapshot {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Partial<ExtraSpeakingTrainingSnapshot>
  return snapshot.schemaVersion === 1 && typeof snapshot.updatedAt === 'string' &&
    typeof snapshot.session === 'object' && snapshot.session !== null &&
    snapshot.session.schemaVersion === 1 && typeof snapshot.session.sessionId === 'string' &&
    Array.isArray(snapshot.pendingEvents)
}

/** JSON-only checkpoint/outbox for an optional speaking block, never a daily task. */
export class ExtraSpeakingTrainingRepository {
  private readonly store: NamespaceStore
  constructor(store: NamespaceStore = localStorageService.namespace(
    EXTRA_SPEAKING_TRAINING_STORAGE_NAMESPACE,
  )) { this.store = store }
  private key(sessionId: string) { return `session:${sessionId}` }
  async load(sessionId: string): Promise<ExtraSpeakingTrainingSnapshot | undefined> {
    const record = await this.store.get<ExtraSpeakingTrainingSnapshot>(this.key(sessionId))
    if (!record || valid(record.value) && record.value.session.sessionId === sessionId) return record?.value
    await this.store.delete(this.key(sessionId))
    return undefined
  }
  async save(snapshot: ExtraSpeakingTrainingSnapshot): Promise<void> {
    const json = JSON.stringify(snapshot)
    if (json === undefined || !valid(JSON.parse(json))) throw new TypeError('Extra speaking checkpoint must be JSON-portable.')
    await this.store.put(this.key(snapshot.session.sessionId), JSON.parse(json), 1)
  }
  delete(sessionId: string) { return this.store.delete(this.key(sessionId)) }
}
