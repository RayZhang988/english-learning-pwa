import { describe, expect, it } from 'vitest'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { createLearningEngineState, LearningEngineRepository } from '../../learning-engine/index.ts'
import { abilityProfile } from '../../learning-engine/test-fixtures.ts'
import { GrowthProductionCoordinator, toGrowthDomainViewModel } from './growth-production.ts'

class MemoryStore implements NamespaceStore {
  readonly values = new Map<string, StoredRecord<unknown>>()
  async get<T>(key: string): Promise<StoredRecord<T> | undefined> { return this.values.get(key) as StoredRecord<T> | undefined }
  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> { this.values.set(key, { namespace: 'memory', key, value, schemaVersion, updatedAt: '2026-08-13T00:00:00.000Z' }) }
  async delete(key: string): Promise<void> { this.values.delete(key) }
  async keys(): Promise<readonly string[]> { return [...this.values.keys()] }
  async clear(): Promise<void> { this.values.clear() }
}

const index = (domain: 'vocabulary' | 'listening' | 'speaking') => ({
  candidates: Array.from({ length: 12 }, (_, number) => ({ itemId: `${domain}-level-1-${number}`, domain, difficultyLevel: 0.5 })),
})

function setup() {
  const store = new MemoryStore()
  const repository = new LearningEngineRepository(store)
  const source = (domain: 'vocabulary' | 'listening' | 'speaking') => ({ load: async () => ({ trainingSupplyIndex: index(domain) }) })
  const coordinator = new GrowthProductionCoordinator({ engineStates: repository, sources: { vocabulary: source('vocabulary'), listening: source('listening'), speaking: source('speaking') } })
  return { store, repository, coordinator }
}

describe('GrowthProductionCoordinator', () => {
  it('records only supplied formal domain summaries and resumes a stable upgrade order', async () => {
    const { repository, coordinator } = setup()
    await repository.save(createLearningEngineState(abilityProfile(), '2026-08-13T00:00:00.000Z'))
    for (let number = 0; number < 5; number += 1) {
      await coordinator.recordFormalSession({ eventId: `e-${number}`, source: 'daily-training', sessionId: `s-${number}`, domain: 'vocabulary', correctCount: 10, incorrectCount: 0, localDate: '2026-08-13', completedAt: `2026-08-13T00:0${number}:00.000Z` })
    }
    expect((await coordinator.view('vocabulary')).eligibility).toBe('eligible')
    await coordinator.startUpgradeTest({ eventId: 'start', domain: 'vocabulary', seed: 12, startedAt: '2026-08-13T01:00:00.000Z' })
    const first = await coordinator.view('vocabulary')
    expect(first.activeTest?.itemIds).toHaveLength(10)
    await coordinator.submitUpgradeAnswer({ eventId: 'answer-0', domain: 'vocabulary', index: 0, correct: true, draft: 'answer', answeredAt: '2026-08-13T01:01:00.000Z' })
    const restored = await coordinator.view('vocabulary')
    expect(restored.activeTest).toMatchObject({ itemIds: first.activeTest?.itemIds, index: 1, score: { correctCount: 1, answeredCount: 1 } })
    expect((await coordinator.view('listening')).scoredItemCount).toBe(0)
  })

  it('backs up and resets only a corrupt growth payload', async () => {
    const { store, repository } = setup()
    const state = createLearningEngineState(abilityProfile(), '2026-08-13T00:00:00.000Z')
    await repository.save({ ...state, growth: { schemaVersion: 999 } as never })
    const recovered = await repository.resetCorruptGrowthOnly()
    expect(recovered.progress).toEqual(state.progress)
    expect(recovered.growth?.schemaVersion).toBe(2)
    expect(store.values.get('learning-engine-growth-corrupt-backup')).toBeDefined()
  })

  it('gives 02 an honest read-only view model for cooling, highest and active states', () => {
    const state = createLearningEngineState(abilityProfile(), '2026-08-13T00:00:00.000Z')
    expect(toGrowthDomainViewModel(state.growth!, 'speaking')).toMatchObject({ currentLevelLabel: '幼儿园', eligibility: 'ineligible', action: { disabled: true } })
  })

  it('routes a persisted vocabulary item through its adapter and atomically advances only one answer', async () => {
    const { repository } = setup()
    const adapters = {
      vocabulary: {
        resolve: async ({ itemId }: { readonly itemId: string }) => ({ itemId, type: 'term-to-meaning' as const, instructionZh: '选择', prompt: 'hello', promptLocale: 'en-US' as const, partOfSpeech: null, options: [{ id: 'a', label: '你好' }] }),
        submit: async ({ itemId }: { readonly itemId: string }) => ({ itemId, scorable: true as const, correct: true, feedback: { correct: true, title: '回答正确', description: 'ok', exampleEn: 'hello', explanationZh: '你好' } }),
      },
      listening: {} as never,
      speaking: {} as never,
    }
    const source = (domain: 'vocabulary' | 'listening' | 'speaking') => ({ load: async () => ({ trainingSupplyIndex: index(domain) }) })
    const coordinator = new GrowthProductionCoordinator({ engineStates: repository, sources: { vocabulary: source('vocabulary'), listening: source('listening'), speaking: source('speaking') }, adapters })
    await repository.save(createLearningEngineState(abilityProfile(), '2026-08-13T00:00:00.000Z'))
    for (let number = 0; number < 5; number += 1) await coordinator.recordFormalSession({ eventId: `v-${number}`, source: 'daily-training', sessionId: `v-${number}`, domain: 'vocabulary', correctCount: 10, incorrectCount: 0, localDate: '2026-08-13', completedAt: `2026-08-13T01:0${number}:00.000Z` })
    await coordinator.startUpgradeTest({ eventId: 'start-v', domain: 'vocabulary', seed: 3, startedAt: '2026-08-13T02:00:00.000Z' })
    const before = await coordinator.upgradeSession('vocabulary')
    expect(before).toMatchObject({ index: 0, total: 10, question: { domain: 'vocabulary' } })
    const answer = await coordinator.submitUpgradeSessionAnswer({ eventId: 'answer-v-0', domain: 'vocabulary', answer: { domain: 'vocabulary', selectedOptionId: 'a' }, answeredAt: '2026-08-13T02:01:00.000Z' })
    expect(answer).toMatchObject({ advanced: true, feedback: { domain: 'vocabulary', submission: { correct: true } } })
    expect((await coordinator.upgradeSession('vocabulary')).index).toBe(1)
  })
})
