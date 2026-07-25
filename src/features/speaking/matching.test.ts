import { describe, expect, it } from 'vitest'
import {
  matchSpeakingText,
  normalizeSpeakingText,
} from './matching.ts'

describe('speaking text matching', () => {
  it('normalizes punctuation, apostrophes, case, and common contractions', () => {
    expect(normalizeSpeakingText('  I’m FROM Shanghai! ')).toBe(
      'i am from shanghai',
    )
  })

  it('matches only against the controlled accepted answer set', () => {
    const result = matchSpeakingText(
      'I am from Shanghai',
      ["I'm from Shanghai.", "I'm from Beijing."],
    )

    expect(result.level).toBe('match')
    expect(result.closestAcceptedAnswer).toBe("I'm from Shanghai.")
    expect(result.similarity).toBe(1)
  })

  it('labels small omissions as close without claiming pronunciation quality', () => {
    const result = matchSpeakingText(
      'sorry could you repeat the total',
      ['Sorry, could you repeat the total, please?'],
    )

    expect(result.level).toBe('close')
    expect(result.similarity).toBeGreaterThanOrEqual(0.8)
  })

  it('keeps unrelated recognition text visibly different', () => {
    const result = matchSpeakingText(
      'the weather is nice today',
      ['I would like a medium coffee to go please'],
    )

    expect(result.level).toBe('different')
  })
})
