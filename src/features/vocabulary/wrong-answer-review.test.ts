import { describe, expect, it } from 'vitest'
import type { VocabularyCatalog, VocabularySupplyItem } from './types.ts'
import { createVocabularyWrongAnswerEvidence, resolveDailyVocabularyReviewContent, resolveSceneVocabularyReviewContent } from './wrong-answer-review.ts'

const item = { id: 'term', term: 'passport', partOfSpeech: 'noun', meaningZh: '护照', exampleEn: 'Show your passport.', exampleZh: '出示护照。' }
const distractorA = { ...item, id: 'a', term: 'ticket', meaningZh: '票' }
const distractorB = { ...item, id: 'b', term: 'hotel', meaningZh: '酒店' }
const catalog: VocabularyCatalog = { schemaVersion: 1, packageVersion: '1.0.0', courseId: 'course', units: [], getUnit: () => undefined, getItem: (id) => ({ term: item, a: distractorA, b: distractorB } as Record<string, typeof item>)[id] }
const supply: VocabularySupplyItem = { schemaVersion: 1, itemId: 'supply-1', learningUnitId: 'unit', contentRef: 'lesson://unit', difficultyLevel: 2, tags: [], domain: 'vocabulary', targetModuleId: 'vocabulary', source: { sourceType: 'vocabulary-item', sourceId: 'term', variantId: 'term-to-meaning-choice', distractorItemIds: ['a', 'b'] } }
const index = { schemaVersion: 1 as const, documentType: 'review-content-index' as const, contentVersion: '1.0.0' as const, aliases: {
  'daily:supply-1': { reviewContentId: 'r1', originalQuestionType: 'vocabulary-term-to-meaning-choice', domain: 'vocabulary' as const, source: { kind: 'daily-supply', itemId: 'supply-1', variantId: 'term-to-meaning-choice' } },
  'scene:bank@1.0.0:q1': { reviewContentId: 'r2', originalQuestionType: 'scene-vocabulary-meaning-choice', domain: 'vocabulary' as const, source: { kind: 'scene-vocabulary-bank', questionId: 'q1' } },
} }

describe('R13-D vocabulary review content', () => {
  it('resolves released daily aliases and creates stable retry evidence', () => {
    const resolved = resolveDailyVocabularyReviewContent(index, supply, catalog)
    expect(resolved.question.type).toBe('term-to-meaning')
    const first = createVocabularyWrongAnswerEvidence({ identity: resolved.identity, source: 'daily-training', taskOrSessionId: 'task', questionId: 'q', submittedAt: '2026-08-03T00:00:00.000Z', correct: false })
    expect(first.eventId).toBe(createVocabularyWrongAnswerEvidence({ identity: resolved.identity, source: 'daily-training', taskOrSessionId: 'task', questionId: 'q', submittedAt: '2026-08-03T00:00:00.000Z', correct: false }).eventId)
    expect(first.outcome).toBe('incorrect')
  })
  it('rejects alias drift and retains scene target-only identity', () => {
    expect(resolveSceneVocabularyReviewContent(index, 'bank', '1.0.0', { questionId: 'q1', sentenceEn: 'Show passport.', targetText: 'passport', targetOccurrence: 1, correctMeaningZh: '护照', distractorMeaningsZh: ['票', '酒店', '签证'], source: { sourceId: 'x', kind: 'project-authored-controlled-text', rights: 'original-project-content' } }).reviewContentId).toBe('r2')
    expect(() => resolveDailyVocabularyReviewContent(index, { ...supply, itemId: 'other' }, catalog)).toThrow('missing')
  })
})
