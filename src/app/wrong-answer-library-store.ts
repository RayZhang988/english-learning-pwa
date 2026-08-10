import {
  applyWrongAnswerEvidence,
  assertWrongAnswerLibraryState,
  createWrongAnswerLibraryState,
  type WrongAnswerEvidence,
  type WrongAnswerLibraryState,
  type WrongAnswerLibraryStatePort,
  type WrongAnswerLibraryStateTransform,
} from '../learning-engine/index.ts'
import { assertPortableValue } from '../storage/portable-value.ts'
import { createRecordId } from '../storage/record-id.ts'
import { appDatabase, type AppDatabase, type DatabaseRecord } from '../storage/indexed-db/AppDatabase.ts'

export const WRONG_ANSWER_LIBRARY_NAMESPACE = 'app.wrong-answer-library'
export const WRONG_ANSWER_LIBRARY_KEY = 'library-v1'
export const WRONG_ANSWER_LIBRARY_BACKUP_NAMESPACE = 'app.wrong-answer-library-backup'

export interface WrongAnswerLibraryCorruptBackup {
  readonly schemaVersion: 1
  readonly capturedAt: string
  readonly reason: string
  readonly value: unknown
}

function libraryRecord(value: WrongAnswerLibraryState, now: string): DatabaseRecord {
  return { id: createRecordId(WRONG_ANSWER_LIBRARY_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY), namespace: WRONG_ANSWER_LIBRARY_NAMESPACE, key: WRONG_ANSWER_LIBRARY_KEY, value, schemaVersion: 1, updatedAt: now }
}

/**
 * 01 production persistence. A Dexie read/write transaction covers the one
 * shared records table, so separate store instances and browser tabs cannot
 * both read an old value and overwrite each other.
 */
export class WrongAnswerLibraryStore implements WrongAnswerLibraryStatePort {
  readonly #database: AppDatabase
  readonly #now: () => string

  constructor(database: AppDatabase = appDatabase, now: () => string = () => new Date().toISOString()) {
    this.#database = database
    this.#now = now
  }

  async #read(): Promise<WrongAnswerLibraryState> {
    const stored = await this.#database.records.get(createRecordId(WRONG_ANSWER_LIBRARY_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY))
    if (!stored) return createWrongAnswerLibraryState()
    assertWrongAnswerLibraryState(stored.value)
    return stored.value
  }

  async load(): Promise<WrongAnswerLibraryState> {
    try {
      return await this.#database.transaction('r', this.#database.records, () => this.#read())
    } catch (error) {
      await this.#backupCorrupt(error)
      throw error
    }
  }

  async update(transform: WrongAnswerLibraryStateTransform): Promise<WrongAnswerLibraryState> {
    return this.#database.transaction('rw', this.#database.records, async () => {
      const current = await this.#read()
      const next = transform(current)
      assertWrongAnswerLibraryState(next)
      assertPortableValue(next)
      // Writing is intentional even for the same reference: update never
      // pretends durability happened merely because object identity matches.
      await this.#database.records.put(libraryRecord(next, this.#now()))
      return next
    })
  }

  publish(evidence: WrongAnswerEvidence): Promise<WrongAnswerLibraryState> {
    return this.update((state) => applyWrongAnswerEvidence(state, evidence).state)
  }

  async resetAfterUserRecovery(): Promise<void> {
    await this.#database.transaction('rw', this.#database.records, () =>
      this.#database.records.delete(createRecordId(WRONG_ANSWER_LIBRARY_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY)),
    )
  }

  async corruptBackups(): Promise<readonly WrongAnswerLibraryCorruptBackup[]> {
    const records = await this.#database.records.where('namespace').equals(WRONG_ANSWER_LIBRARY_BACKUP_NAMESPACE).toArray()
    return records.map((record) => record.value as WrongAnswerLibraryCorruptBackup)
  }

  async #backupCorrupt(error: unknown): Promise<void> {
    const sourceId = createRecordId(WRONG_ANSWER_LIBRARY_NAMESPACE, WRONG_ANSWER_LIBRARY_KEY)
    await this.#database.transaction('rw', this.#database.records, async () => {
      const corrupt = await this.#database.records.get(sourceId)
      if (!corrupt) return
      const capturedAt = this.#now()
      const key = `corrupt-${capturedAt}-${crypto.randomUUID()}`
      const backup: WrongAnswerLibraryCorruptBackup = { schemaVersion: 1, capturedAt, reason: error instanceof Error ? error.message : 'invalid-state', value: corrupt.value }
      assertPortableValue(backup)
      await this.#database.records.put({ id: createRecordId(WRONG_ANSWER_LIBRARY_BACKUP_NAMESPACE, key), namespace: WRONG_ANSWER_LIBRARY_BACKUP_NAMESPACE, key, value: backup, schemaVersion: 1, updatedAt: capturedAt })
    })
  }
}

export const wrongAnswerLibraryStore = new WrongAnswerLibraryStore()
