import { describe, expect, it } from 'vitest'
import { createVocabularyCatalog } from './content.ts'
import { buildVocabularySupplyQuestion } from './questions.ts'
import { VocabularyCatalogSupplyProvider } from './supply.ts'
import { loadActualVocabularyDocuments, vocabularyTaskFor } from './test-fixtures.ts'
import type { VocabularySupplyItem } from './types.ts'
import { createTrainingSupplyRound } from '../../learning-engine/index.ts'

describe('vocabulary training supply', () => {
  it('bulk-enumerates schema-2 identities with published semantic metadata', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const request = { schemaVersion: 1 as const, requestId: 'semantic-eligible', planId: 'plan', taskId: 'task', domain: 'vocabulary' as const, targetModuleId: 'vocabulary' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [] as readonly string[], reason: 'initial' as const }

    const result = await provider.eligibleCandidateIdentities(request)

    expect(result.status).toBe('eligible-candidates')
    if (result.status !== 'eligible-candidates') return
    expect(result.candidates.length).toBeGreaterThan(100)
    expect(result.candidates[0]).toEqual({
      itemId: expect.any(String),
      knowledgePointId: expect.stringMatching(/^knowledge-v1-vocabulary-/u),
      semanticCategoryId: expect.stringMatching(/^semantic-v1/u),
    })
    expect(Object.keys(result.candidates[0]!)).toEqual([
      'itemId', 'knowledgePointId', 'semanticCategoryId',
    ])
  })

  it('bulk-enumerates the same eligible ids as repeated next calls', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const request = { schemaVersion: 1 as const, requestId: 'eligible', planId: 'plan', taskId: 'task', domain: 'vocabulary' as const, targetModuleId: 'vocabulary' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [] as readonly string[], reason: 'initial' as const }
    const expected: string[] = []

    while (true) {
      const result = await provider.next({
        ...request,
        requestId: `next-${expected.length}`,
        excludeItemIds: expected,
      })
      if (result.status === 'content-exhausted') break
      expected.push(result.item.itemId)
    }

    await expect(provider.eligibleItemIds(request)).resolves.toEqual({
      schemaVersion: 1,
      requestId: 'eligible',
      status: 'eligible-items',
      itemIds: expected,
    })
  })

  it('bulk-enumerates more than 3000 unique ids in stable supply order', async () => {
    const candidateCount = 4_215
    const candidates = Array.from({ length: candidateCount }, (_, index) => ({
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      itemId: `item-${index}`,
      learningUnitId: 'unit',
      contentRef: 'content',
      difficultyLevel: 1,
      tags: ['travel'],
      supplyOrder: candidateCount - index,
      allowedModes: ['learn'],
      variantFamilyId: `family-${index}`,
      knowledgePointId: `knowledge-${index}`,
      semanticCategoryId: `semantic-${index % 19}`,
      source: {
        sourceType: 'vocabulary-item',
        sourceId: `source-${index}`,
        variantId: 'term-to-meaning-choice',
        distractorItemIds: ['distractor'],
      },
    }))
    const catalog = {
      getUnit: () => ({}),
      getItem: () => ({}),
    } as unknown as ReturnType<typeof createVocabularyCatalog>
    const provider = new VocabularyCatalogSupplyProvider({ schemaVersion: 1, candidates }, catalog)
    const startedAt = performance.now()
    const result = await provider.eligibleCandidateIdentities({ schemaVersion: 1, requestId: 'large', planId: 'plan', taskId: 'task', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' })
    const elapsedMs = performance.now() - startedAt

    expect(result.status).toBe('eligible-candidates')
    if (result.status !== 'eligible-candidates') return
    expect(result.candidates).toHaveLength(candidateCount)
    expect(new Set(result.candidates.map((candidate) => candidate.itemId)).size).toBe(candidateCount)
    expect(result.candidates.slice(0, 3).map((candidate) => candidate.itemId)).toEqual(['item-4214', 'item-4213', 'item-4212'])
    expect(elapsedMs).toBeLessThan(1_000)
  })

  it('rejects missing or malformed semantic metadata instead of inventing it', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const index = structuredClone(catalog.trainingSupplyIndex) as { candidates: Array<Record<string, unknown>> }
    delete index.candidates[0]!.knowledgePointId

    expect(() => new VocabularyCatalogSupplyProvider(index, catalog)).toThrow(/invalid vocabulary fields/u)
  })

  it('returns a distinguishable safe failure for invalid bulk requests', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const result = await provider.eligibleItemIds({ schemaVersion: 1, requestId: 'invalid', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' } as never)

    expect(result).toEqual({
      schemaVersion: 1,
      requestId: 'invalid',
      status: 'invalid-request',
      reason: 'provider-failure',
    })
    expect(JSON.stringify(result)).not.toContain('correct')
    expect(JSON.stringify(result)).not.toContain('answer')
  })

  it('selects stable non-repeating approved vocabulary items', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const task = vocabularyTaskFor(catalog.units[0], { trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const first = await provider.next({ schemaVersion: 1, requestId: 'request-1', planId: task.planId, taskId: task.taskId, domain: 'vocabulary', targetModuleId: 'vocabulary', mode: task.mode, targetDifficulty: task.difficultyLevel, cursor: null, excludeItemIds: [], reason: 'initial' })
    expect(first).toMatchObject({ status: 'item' })
    if (first.status !== 'item') return
    const second = await provider.next({ schemaVersion: 1, requestId: 'request-2', planId: task.planId, taskId: task.taskId, domain: 'vocabulary', targetModuleId: 'vocabulary', mode: task.mode, targetDifficulty: task.difficultyLevel, cursor: first.nextCursor, excludeItemIds: [first.item.itemId], reason: 'continue-after-item' })
    expect(second.status).toBe('item')
    if (second.status !== 'item') return
    expect(second.item.itemId).not.toBe(first.item.itemId)
    const supplied = first.item as VocabularySupplyItem
    const source = catalog.getItem(supplied.source.sourceId)
    expect(source).toBeDefined()
    const question = buildVocabularySupplyQuestion(supplied.itemId, source!, supplied.source.distractorItemIds.map((id) => catalog.getItem(id)!), supplied.source.variantId)
    expect(question.id).toContain(first.item.itemId)
    expect(question.options.length).toBeGreaterThanOrEqual(3)
  })

  it('reports exhaustion instead of clearing exclusions and looping', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const result = await provider.next({ schemaVersion: 1, requestId: 'request', planId: 'plan', taskId: 'task', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 0.5, cursor: null, excludeItemIds: (catalog.trainingSupplyIndex as { candidates: { itemId: string }[] }).candidates.map((item) => item.itemId), reason: 'continue-after-item' })
    expect(result).toMatchObject({ status: 'content-exhausted', reason: 'all-eligible-content-recently-used' })
  })

  it('uses the persisted randomized round order instead of source-file order', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const candidateIds = (catalog.trainingSupplyIndex as { candidates: { itemId: string; difficultyLevel: number }[] }).candidates
      .filter((candidate) => candidate.itemId.startsWith('supply-v1-vocabulary-') && candidate.difficultyLevel === 1)
      .map((candidate) => candidate.itemId)
    const firstBySourceOrder = candidateIds[0]!
    const round = ['round-a', 'round-b', 'round-c', 'round-d']
      .map((seed) => createTrainingSupplyRound({ seed, candidateItemIds: candidateIds, shortTermExcludedItemIds: [] }))
      .find((candidate) => candidate.order[0] !== firstBySourceOrder)!

    const result = await provider.next({
      schemaVersion: 1,
      requestId: 'random-order',
      planId: 'plan',
      taskId: 'task',
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      mode: 'learn',
      targetDifficulty: 1,
      cursor: null,
      excludeItemIds: [],
      supplyRound: round,
      reason: 'initial',
    })

    expect(result).toMatchObject({ status: 'item', item: { itemId: round.order[0] } })
  })

  it('selects the exact published recent-error item before falling back', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const candidates = (catalog.trainingSupplyIndex as { candidates: { itemId: string; difficultyLevel: number }[] }).candidates
      .filter((candidate) => candidate.itemId.startsWith('supply-v1-vocabulary-') && candidate.difficultyLevel === 1)
    const [recent, due] = candidates
    const request = { schemaVersion: 1 as const, requestId: 'extra-priority', sessionId: 'extra-session', localDate: '2026-07-29', domain: 'vocabulary' as const, targetModuleId: 'vocabulary' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': [recent.itemId], 'due-review': [due.itemId], 'same-day-variant': [], 'new-optional-content': [] }, reason: 'initial' as const }
    await expect(provider.next(request)).resolves.toMatchObject({ status: 'item', item: { itemId: recent.itemId } })
    await expect(provider.next({ ...request, excludeItemIds: [recent.itemId] })).resolves.toMatchObject({ status: 'item', item: { itemId: due.itemId } })
  })

  it('consumes schema-2 priority order instead of re-selecting from request buckets', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const eligible = await provider.eligibleCandidateIdentities({ schemaVersion: 1, requestId: 'eligible-priority', sessionId: 'extra-session', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'], priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, reason: 'initial' })
    expect(eligible.status).toBe('eligible-candidates')
    if (eligible.status !== 'eligible-candidates') return
    const [ordinary, recentError] = eligible.candidates
    const round = createTrainingSupplyRound({
      seed: 'priority-audit',
      candidates: eligible.candidates,
      shortTermExcludedItemIds: [],
      priorityItems: [{ itemId: recentError!.itemId, reason: 'recent-error' }],
    })
    const request = { schemaVersion: 1 as const, requestId: 'extra-priority-round', sessionId: 'extra-session', localDate: '2026-07-29', domain: 'vocabulary' as const, targetModuleId: 'vocabulary' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': [ordinary!.itemId], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, supplyRound: round, reason: 'initial' as const }

    await expect(provider.next(request)).resolves.toMatchObject({
      status: 'item', item: { itemId: recentError!.itemId },
    })
    expect(round.orderAudit[0]).toMatchObject({
      itemId: recentError!.itemId,
      priorityReason: 'recent-error',
    })
  })

  it('rejects a schema-2 priority reason outside the existing R6 priority sources', async () => {
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const provider = new VocabularyCatalogSupplyProvider(catalog.trainingSupplyIndex, catalog)
    const eligible = await provider.eligibleCandidateIdentities({ schemaVersion: 1, requestId: 'eligible-invalid-priority', sessionId: 'extra-session', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'], priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, reason: 'initial' })
    expect(eligible.status).toBe('eligible-candidates')
    if (eligible.status !== 'eligible-candidates') return
    const round = createTrainingSupplyRound({ seed: 'invalid-priority-audit', candidates: eligible.candidates, shortTermExcludedItemIds: [], priorityItems: [{ itemId: eligible.candidates[0]!.itemId, reason: 'invented-priority' }] })

    await expect(provider.next({ schemaVersion: 1, requestId: 'invalid-priority-round', sessionId: 'extra-session', localDate: '2026-07-29', domain: 'vocabulary', targetModuleId: 'vocabulary', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'], priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [] }, supplyRound: round, reason: 'initial' })).resolves.toMatchObject({ status: 'content-exhausted', reason: 'provider-failure' })
  })
})
