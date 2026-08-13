import { createStaticDataSource } from '../../core/testing/index.ts'
import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1/listening.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from './content.ts'
import { createListeningGrowthUpgradeAdapter } from './growth-upgrade.ts'
import type { ListeningSupplyItem } from './types.ts'

function catalog() {
  return createListeningCatalog({ packageIndex, manifest, extensionIndex, trainingSupplyIndex, lessonsByPath: { [packageIndex.lessonFiles[0]]: week1, [packageIndex.lessonFiles[1]]: week2, [packageIndex.lessonFiles[2]]: week3, [packageIndex.lessonFiles[3]]: week4 }, exerciseBundlesByPath: { [extensionIndex.exerciseBundleFiles[0]]: exercises }, bilingualChoiceOptions })
}

describe('listening growth upgrade adapter', () => {
  it.each(['word-discrimination', 'short-sentence-choice', 'keyword-dictation', 'full-transcript-detail-choice', 'scene-audio-single-choice'])(
    'resolves released %s without revealing answers before submission',
    async (variantId) => {
      const current = catalog()
      const item = (current.trainingSupplyIndex as { candidates: readonly ListeningSupplyItem[] }).candidates.find((candidate) => candidate.source.variantId === variantId)!
      const adapter = createListeningGrowthUpgradeAdapter(createStaticDataSource(current))
      const view = await adapter.resolve({ domain: 'listening', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })
      expect(view).toMatchObject({ itemId: item.itemId, playback: { segments: expect.any(Array) } })
      expect(JSON.stringify(view)).not.toContain('correctOptionId')
      expect(JSON.stringify(view)).not.toContain('translationZh')
      if (view.question.kind === 'keyword-dictation') expect(view.question.requirements.countLabel).toContain('需要填写')
    },
  )

  it('uses the formal scorer and reveals R9/R10 material only after submission', async () => {
    const current = catalog()
    const item = (current.trainingSupplyIndex as { candidates: readonly ListeningSupplyItem[] }).candidates.find((candidate) => candidate.source.variantId === 'keyword-dictation')!
    const adapter = createListeningGrowthUpgradeAdapter(createStaticDataSource(current))
    const view = await adapter.resolve({ domain: 'listening', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })
    if (view.question.kind !== 'keyword-dictation') throw new Error('expected dictation')
    const result = await adapter.submit({ domain: 'listening', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel, response: 'wrong' })
    expect(result).toMatchObject({ scorable: true, correct: false, disclosure: { dictationReview: expect.any(Object) } })
    expect(await adapter.submit({ domain: 'listening', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel, response: 'wrong' })).toEqual(result)
  })

  it('rejects non-listening, unknown and cross-level identities', async () => {
    const current = catalog(); const item = (current.trainingSupplyIndex as { candidates: readonly ListeningSupplyItem[] }).candidates[0]!
    const adapter = createListeningGrowthUpgradeAdapter(createStaticDataSource(current))
    await expect(adapter.resolve({ domain: 'vocabulary', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel })).rejects.toThrow('requires listening domain')
    await expect(adapter.resolve({ domain: 'listening', itemId: 'scene:airport:question:1', expectedDifficultyLevel: item.difficultyLevel })).rejects.toThrow('not a released daily listening item')
    await expect(adapter.resolve({ domain: 'listening', itemId: item.itemId, expectedDifficultyLevel: item.difficultyLevel + 0.5 })).rejects.toThrow('does not match')
  })
})
