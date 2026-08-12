import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createSceneVocabularyQuestionBank } from '../features/vocabulary/index.ts'
import type { WrongAnswerRecord } from '../learning-engine/index.ts'
import { ProductionWrongAnswerReviewContentResolver } from './wrong-answer-review-content-resolver.ts'
import { releasedCatalogs } from '../../tests/qa/fixtures/production-course.ts'
import { loadReleasedReviewContentIndex } from './review-content-test-fixtures.ts'

const root = new URL('../../', import.meta.url)
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(new URL(path, root), 'utf8')) as unknown }

describe('R13-D production review resolver coverage', () => {
  it('resolves every one of the 3945 released aliases without probing answers', async () => {
    const { vocabulary, listening, speaking } = releasedCatalogs()
    const index = await loadReleasedReviewContentIndex()
    const scene = createSceneVocabularyQuestionBank(await json('content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json'))
    const resolver = new ProductionWrongAnswerReviewContentResolver({ index: { load: async () => index }, vocabulary: { load: async () => vocabulary }, sceneVocabulary: { load: async () => scene }, listening: { load: async () => listening }, speaking: { load: async () => speaking } })
    const aliases = Object.values(index.aliases)
    expect(aliases).toHaveLength(3945)
    const counts = { vocabulary: 0, listening: 0, speaking: 0 }
    for (const alias of aliases) {
      const record: WrongAnswerRecord = { schemaVersion: 1, recordId: `${alias.reviewContentId}::${alias.originalQuestionType}`, reviewContentId: alias.reviewContentId, originalQuestionType: alias.originalQuestionType, domain: alias.domain, status: 'active', incorrectCount: 1, consecutiveReviewCorrect: 0, lastIncorrectAt: '2026-08-10T00:00:00.000Z', lastReviewAttemptAt: null, movedToHistoryAt: null, lastSource: 'daily-training', sources: ['daily-training'] }
      const resolved = await resolver.resolve(record)
      expect(resolved.kind).toBe(alias.domain)
      if (
        resolved.kind === 'listening' &&
        alias.originalQuestionType === 'listening-keyword-dictation'
      ) {
        expect(resolved.question.type).toBe('keyword-dictation')
        if (resolved.question.type === 'keyword-dictation') {
          expect(resolved.question.answerGuidance.guidanceZh.trim()).not.toBe('')
          expect(
            JSON.parse(JSON.stringify(resolved.question)).answerGuidance,
          ).toEqual(resolved.question.answerGuidance)
        }
      }
      if (resolved.kind === 'speaking') expect(resolved.prompt.modelAnswerTranslationZh.trim().length).toBeGreaterThan(0)
      counts[alias.domain] += 1
    }
    expect(counts).toEqual({ vocabulary: 3570, listening: 253, speaking: 122 })
  })
})
