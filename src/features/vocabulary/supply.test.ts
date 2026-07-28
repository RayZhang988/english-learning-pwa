import { describe, expect, it } from 'vitest'
import { createVocabularyCatalog } from './content.ts'
import { buildVocabularySupplyQuestion } from './questions.ts'
import { VocabularyCatalogSupplyProvider } from './supply.ts'
import { loadActualVocabularyDocuments, vocabularyTaskFor } from './test-fixtures.ts'
import type { VocabularySupplyItem } from './types.ts'

describe('vocabulary training supply', () => {
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
})
