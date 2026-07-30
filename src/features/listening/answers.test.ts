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

  it('accepts declared target keywords in order without requiring connector words', () => {
    const question = {
      ...dictationQuestion,
      targetKeywords: ['three', 'Wu'],
      standardAnswer: 'three under Wu',
      acceptedAnswers: [
        'three under Wu',
        'a table for three under Wu',
      ],
    }

    expect(judgeKeywordDictation(question, 'three Wu')).toBe(true)
    expect(judgeKeywordDictation(question, 'three under Wu')).toBe(true)
    expect(judgeKeywordDictation(question, 'Wu three')).toBe(false)
    expect(judgeKeywordDictation(question, 'three people Wu')).toBe(false)
  })

  it('treats hyphenated target keywords and spaced input as the same keyword sequence', () => {
    const question = {
      ...dictationQuestion,
      targetKeywords: ['two', 'one-way', 'tickets'],
      standardAnswer: 'two one-way tickets',
      acceptedAnswers: [
        'two one-way tickets',
        'two one way tickets',
        '2 one-way tickets',
      ],
    }

    expect(judgeKeywordDictation(question, 'two one way tickets')).toBe(true)
    expect(judgeKeywordDictation(question, 'two tickets one way')).toBe(false)
  })
})
