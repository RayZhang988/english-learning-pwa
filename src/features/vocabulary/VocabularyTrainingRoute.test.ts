import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink, createStaticDataSource } from '../../core/testing/index.ts'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { createVocabularyCatalog } from './content.ts'
import { VocabularySessionRepository } from './repository.ts'
import { createVocabularyTrainingRouteRuntime } from './VocabularyTrainingRoute.tsx'
import { loadActualVocabularyDocuments, vocabularyTaskFor } from './test-fixtures.ts'

class MemoryStore implements NamespaceStore {
  private readonly records = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string): Promise<StoredRecord<T> | undefined> { return this.records.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> { this.records.set(key, { namespace: 'feature.vocabulary', key, value, schemaVersion, updatedAt: '2026-07-28T00:00:00.000Z' }) }
  async delete(key: string): Promise<void> { this.records.delete(key) }
  async keys(): Promise<readonly string[]> { return [...this.records.keys()] }
  async clear(): Promise<void> { this.records.clear() }
}

describe('VocabularyTrainingRoute QA-011 ports', () => {
  it('forwards budget ports into a continuous stream and leaves old calls unchanged', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const source = createStaticDataSource(catalog)
    const common = { localDate: '2026-07-28', eventSink: new InMemoryPlatformEventSink(), contentSource: source, onExit: () => undefined }
    const budgetTask = vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const continuous = createVocabularyTrainingRouteRuntime({ ...common, task: budgetTask, repository: new VocabularySessionRepository(new MemoryStore()), trainingBudgetStatus: () => 'running' })
    expect((await continuous.initialize()).stream).not.toBeNull()

    const legacy = createVocabularyTrainingRouteRuntime({ ...common, task: vocabularyTaskFor(catalog.units[0]), repository: new VocabularySessionRepository(new MemoryStore()) })
    expect((await legacy.initialize()).stream).toBeNull()
  })
})
