import { describe, expect, it } from 'vitest'
import {
  judgeKeywordDictation,
  normalizeListeningDictation,
} from './answers.ts'
import { dictationQuestion } from './test-fixtures.ts'

describe('listening dictation answers', () => {
  it('applies only the content-declared normalization rules', () => {
    expect(
      normalizeListeningDictation(
        '  BOSTON...  ',
        dictationQuestion.normalizationHints,
      ),
    ).toBe('boston')
    expect(judgeKeywordDictation(dictationQuestion, 'Boston.')).toBe(true)
    expect(judgeKeywordDictation(dictationQuestion, 'Boston city')).toBe(false)
  })

  it('normalizes smart apostrophes without semantic expansion', () => {
    const question = {
      ...dictationQuestion,
      standardAnswer: "I'm",
      acceptedAnswers: ["I'm"],
    }
    expect(judgeKeywordDictation(question, 'I’m')).toBe(true)
    expect(judgeKeywordDictation(question, 'I am')).toBe(false)
  })
})
