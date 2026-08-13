import { createStaticDataSource } from '../../core/testing/index.ts'
import { describe, expect, it } from 'vitest'
import { createVocabularyCatalog } from './content.ts'
import { createVocabularyGrowthUpgradeAdapter } from './growth-upgrade.ts'
import { loadActualVocabularyDocuments } from './test-fixtures.ts'
import type { VocabularySupplyItem } from './types.ts'

async function adapterFor(variantId?: VocabularySupplyItem['source']['variantId']) {
  const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
  const candidates = (catalog.trainingSupplyIndex as { readonly candidates: readonly VocabularySupplyItem[] }).candidates
  const item = candidates.find((candidate) => candidate.domain === 'vocabulary' && (variantId === undefined || candidate.source.variantId === variantId))!
  return { adapter: createVocabularyGrowthUpgradeAdapter(createStaticDataSource(catalog)), item }
}

describe('vocabulary growth upgrade adapter', () => {
  it.each(['term-to-meaning-choice', 'meaning-to-term-choice', 'example-gap-choice'] as const)(
    'resolves the released %s item without exposing its answer',
    async (variantId) => {
      const { adapter, item } = await adapterFor(variantId)

      const view = await adapter.resolve({ domain: 'vocabulary', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })

      expect(view).toMatchObject({ itemId: item.itemId, type: variantId === 'example-gap-choice' ? 'example-comprehension' : variantId === 'meaning-to-term-choice' ? 'meaning-to-term' : 'term-to-meaning' })
      expect(view.options).toHaveLength(4)
      expect(JSON.stringify(view)).not.toContain('correctOptionId')
      expect(await adapter.resolve({ domain: 'vocabulary', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })).toEqual(view)
    },
  )

  it('scores a selected answer without emitting normal-training side effects', async () => {
    const { adapter, item } = await adapterFor()
    const view = await adapter.resolve({ domain: 'vocabulary', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })

    const input = { domain: 'vocabulary' as const, itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel, selectedOptionId: view.options[0]!.id }
    const result = await adapter.submit(input)

    expect(result).toMatchObject({ itemId: item.itemId, scorable: true })
    expect(result.feedback).toBeDefined()
    expect(await adapter.submit(input)).toEqual(result)
    await expect(adapter.submit({ ...input, selectedOptionId: 'not-an-option' })).rejects.toThrow('does not belong')
  })

  it('rejects unknown, cross-level and scene IDs instead of silently replacing the item', async () => {
    const { adapter, item } = await adapterFor()

    await expect(adapter.resolve({ domain: 'vocabulary', itemId: 'scene:airport:question:1', expectedDifficultyLevel: item.difficultyLevel })).rejects.toThrow('not a released daily vocabulary item')
    await expect(adapter.resolve({ domain: 'vocabulary', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel + 0.5 })).rejects.toThrow('does not match')
    await expect(adapter.resolve({ domain: 'listening', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })).rejects.toThrow('requires vocabulary domain')
  })
})
