import { describe, expect, it } from 'vitest'
import { createVocabularyDistractorSelector, selectVocabularyDistractors } from './validate-training-supply.v1.mjs'

function source(index: number, difficultyLevel = index % 15 / 2, partOfSpeech = index % 3 === 0 ? 'noun' : 'phrase') {
  return {
    item: { id: `item-${index}`, term: `travel term ${index}`, meaningZh: `旅行词${index}`, partOfSpeech },
    unit: { difficultyLevel },
  }
}

describe('indexed vocabulary distractor selection', () => {
  it('preserves the released selector result for a representative pool', () => {
    const sources = Array.from({ length: 120 }, (_, index) => source(index))
    const indexed = createVocabularyDistractorSelector(sources)
    for (const answer of sources.slice(0, 30)) {
      expect(indexed(answer).map(({ item }) => item.id)).toEqual(selectVocabularyDistractors(answer, sources).map(({ item }) => item.id))
    }
  })

  it('selects distractors for 3000 candidates within the release budget', () => {
    const sources = Array.from({ length: 3000 }, (_, index) => source(index))
    const indexed = createVocabularyDistractorSelector(sources)
    const startedAt = performance.now()
    for (const answer of sources) expect(indexed(answer)).toHaveLength(3)
    expect(performance.now() - startedAt).toBeLessThan(1500)
  })

  it('keeps different number words as distinct scored vocabulary', () => {
    const sources = [
      { item: { id: 'one', term: 'one', meaningZh: '一', partOfSpeech: 'number' }, unit: { difficultyLevel: 0 } },
      { item: { id: 'two', term: 'two', meaningZh: '二', partOfSpeech: 'number' }, unit: { difficultyLevel: 0 } },
      { item: { id: 'three', term: 'three', meaningZh: '三', partOfSpeech: 'number' }, unit: { difficultyLevel: 0 } },
      { item: { id: 'four', term: 'four', meaningZh: '四', partOfSpeech: 'number' }, unit: { difficultyLevel: 0 } },
    ]
    expect(selectVocabularyDistractors(sources[0], sources).map(({ item }) => item.id).sort()).toEqual(['four', 'three', 'two'])
  })
})
