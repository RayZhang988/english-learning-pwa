import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { loadReleasedReviewContentIndex } from '../../app/review-content-test-fixtures.ts'
import { createVocabularyCatalog } from './content.ts'
import { loadActualVocabularyDocuments } from './test-fixtures.ts'
import { createSceneVocabularyQuestionBank } from './scene-vocabulary-practice.ts'
import type { VocabularyCatalog, VocabularySupplyItem } from './types.ts'
import { createVocabularyWrongAnswerEvidence, resolveDailyVocabularyReviewContent, resolveSceneVocabularyReviewContent, resolveSceneVocabularyReviewQuestion } from './wrong-answer-review.ts'

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
  it('strictly resolves every released 05 daily and scene alias against released sources', async () => {
    const root = new URL('../../../', import.meta.url)
    const releasedIndex = await loadReleasedReviewContentIndex() as typeof index
    const catalog = createVocabularyCatalog(await loadActualVocabularyDocuments())
    const daily = (catalog.trainingSupplyIndex as { candidates: readonly VocabularySupplyItem[] }).candidates.filter((candidate) => candidate.domain === 'vocabulary')
    expect(daily).toHaveLength(5244)
    for (const candidate of daily) {
      const resolved = resolveDailyVocabularyReviewContent(releasedIndex, candidate, catalog)
      expect(resolved.identity.originalQuestionType).toContain(candidate.source.variantId.replace('-choice', ''))
      expect(resolved.question.options.some((option) => option.id === resolved.question.correctOptionId)).toBe(true)
    }
    const bank = createSceneVocabularyQuestionBank(JSON.parse(await readFile(new URL('content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json', root), 'utf8')) as unknown)
    const questions = bank.scenes.flatMap((scene) => scene.questions)
    expect(questions).toHaveLength(612)
    for (const question of questions) {
      const resolved = resolveSceneVocabularyReviewContent(releasedIndex, bank.bankId, bank.contentVersion, question)
      expect(resolved.source.questionId).toBe(question.questionId)
      expect(resolved.originalQuestionType).toBe('scene-vocabulary-meaning-choice')
      const view = resolveSceneVocabularyReviewQuestion(releasedIndex, bank, resolved)
      expect(view.questionId).toBe(question.questionId)
      expect(view.options.find((option) => option.id === view.correctOptionId)?.label).toBe(question.correctMeaningZh)
      expect(view.scenePresentation).toEqual({
        sentenceEn: {
          beforeTarget: question.sentenceEn.slice(0, question.sentenceEn.toLocaleLowerCase('en-US').indexOf(question.targetText.toLocaleLowerCase('en-US'))),
          targetText: question.targetText,
          afterTarget: question.sentenceEn.slice(question.sentenceEn.toLocaleLowerCase('en-US').indexOf(question.targetText.toLocaleLowerCase('en-US')) + question.targetText.length),
        },
        targetPlayback: { intent: 'play-target-only', text: question.targetText, locale: 'en-US' },
      })
    }
  })
})
