import { describe, expect, it } from 'vitest'
import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import {
  createVocabularyAssessmentSessionV2,
  getNextVocabularyAssessmentItemV2,
  submitVocabularyAssessmentResponseV2,
} from './vocabulary-engine.ts'
import { buildVocabularyAbilityProfileV2 } from './vocabulary-profile.ts'
import type {
  VocabularyAnswerV2,
  VocabularyAssessmentSessionV2,
} from './vocabulary-types.ts'

const startedAt = Date.parse('2026-07-27T00:00:00.000Z')

function iso(elapsedMs: number): string {
  return new Date(startedAt + elapsedMs).toISOString()
}

function answerOption(
  itemId: string,
  answer: VocabularyAnswerV2,
): string | null {
  if (answer === 'uncertain') {
    return null
  }
  const item = vocabularyPlacementBankV2.items.find(
    (candidate) => candidate.id === itemId,
  )
  if (!item) {
    throw new Error(`Missing private item ${itemId}`)
  }
  if (answer === 'correct') {
    return item.scoring.correctOptionId
  }
  return (
    item.options.find(
      (option) => option.id !== item.scoring.correctOptionId,
    )?.id ?? null
  )
}

function run(input: {
  readonly id: string
  readonly answer: (
    index: number,
    session: VocabularyAssessmentSessionV2,
  ) => VocabularyAnswerV2
  readonly durationMs?: number
}) {
  let session = createVocabularyAssessmentSessionV2({
    id: input.id,
    startedAt: iso(0),
    bank: vocabularyPlacementBankV2,
  })
  const difficulties: number[] = []
  let elapsedMs = 0
  const durationMs = input.durationMs ?? 60_000

  for (let index = 0; index < 20; index += 1) {
    const next = getNextVocabularyAssessmentItemV2(
      session,
      vocabularyPlacementBankV2,
      iso(elapsedMs),
    )
    session = next.session
    if (!next.item) {
      return { session, difficulties, elapsedMs }
    }
    difficulties.push(next.item.difficulty)
    elapsedMs += durationMs
    const answer = input.answer(index, session)
    session = submitVocabularyAssessmentResponseV2({
      session,
      bank: vocabularyPlacementBankV2,
      submission: {
        selectedOptionId: answerOption(next.item.id, answer),
        durationMs,
      },
      submittedAt: iso(elapsedMs),
    }).session
  }
  throw new Error('v2 assessment did not stop within its item cap')
}

describe('v2 adaptive vocabulary engine', () => {
  it('starts with foundation vocabulary, raises after success and lowers after error', () => {
    let session = createVocabularyAssessmentSessionV2({
      id: 'direction',
      startedAt: iso(0),
      bank: vocabularyPlacementBankV2,
    })
    let next = getNextVocabularyAssessmentItemV2(
      session,
      vocabularyPlacementBankV2,
      iso(0),
    )
    session = next.session
    expect(next.item?.difficulty).toBe(0)

    const firstId = next.item?.id
    if (!firstId) {
      throw new Error('Expected first item')
    }
    session = submitVocabularyAssessmentResponseV2({
      session,
      bank: vocabularyPlacementBankV2,
      submission: {
        selectedOptionId: answerOption(firstId, 'correct'),
        durationMs: 60_000,
      },
      submittedAt: iso(60_000),
    }).session
    next = getNextVocabularyAssessmentItemV2(
      session,
      vocabularyPlacementBankV2,
      iso(60_000),
    )
    session = next.session
    expect(next.item?.difficulty).toBe(2)

    const secondId = next.item?.id
    if (!secondId) {
      throw new Error('Expected second item')
    }
    session = submitVocabularyAssessmentResponseV2({
      session,
      bank: vocabularyPlacementBankV2,
      submission: {
        selectedOptionId: answerOption(secondId, 'incorrect'),
        durationMs: 60_000,
      },
      submittedAt: iso(120_000),
    }).session
    next = getNextVocabularyAssessmentItemV2(
      session,
      vocabularyPlacementBankV2,
      iso(120_000),
    )
    expect(next.item?.difficulty).toBeLessThan(2)
  })

  it('finds a lower-censored zero-beginner result without escalating difficulty', () => {
    const result = run({
      id: 'floor',
      answer: () => 'incorrect',
    })
    const profile = buildVocabularyAbilityProfileV2({
      session: result.session,
      completedAt: iso(result.elapsedMs),
    })

    expect(result.difficulties).toHaveLength(8)
    expect(Math.max(...result.difficulties)).toBeLessThanOrEqual(1)
    expect(result.session.completionReason).toBe('lower-boundary')
    expect(profile.abilities.vocabulary.boundary).toBe('lower-censored')
    expect(profile.abilities.vocabulary.internalLevel).toBeLessThanOrEqual(0.5)
  })

  it('finds an upper-censored high result after staged increases', () => {
    const result = run({
      id: 'ceiling',
      answer: () => 'correct',
    })
    const profile = buildVocabularyAbilityProfileV2({
      session: result.session,
      completedAt: iso(result.elapsedMs),
    })

    expect(result.difficulties.slice(0, 7)).toEqual([
      0, 2, 4, 6, 8, 10, 12,
    ])
    expect(result.session.completionReason).toBe('upper-boundary')
    expect(profile.abilities.vocabulary.boundary).toBe('upper-censored')
    expect(profile.abilities.vocabulary.warnings.join(' ')).toContain(
      '不能据此证明达到官方 C2',
    )
  })

  it('converges around reversals instead of mechanically increasing', () => {
    const result = run({
      id: 'alternating',
      answer: (index) => (index % 2 === 0 ? 'correct' : 'incorrect'),
    })

    expect(result.difficulties.some(
      (difficulty, index) =>
        index > 0 &&
        difficulty < (result.difficulties[index - 1] ?? difficulty),
    )).toBe(true)
    expect(result.session.estimate.reversalCount).toBeGreaterThan(0)
    expect(result.session.completionReason).toBe('threshold-converged')
  })

  it('stops repeated uncertainty as low-quality evidence, not wrong answers', () => {
    const result = run({
      id: 'uncertain',
      answer: () => 'uncertain',
    })
    const profile = buildVocabularyAbilityProfileV2({
      session: result.session,
      completedAt: iso(result.elapsedMs),
    })

    expect(result.session.completionReason).toBe('response-quality-limit')
    expect(result.session.estimate.incorrectCount).toBe(0)
    expect(result.session.estimate.uncertainCount).toBe(4)
    expect(profile.abilities.vocabulary.status).toBe('unavailable')
  })

  it('downweights rapid guesses and stops a continuous guessing streak', () => {
    const result = run({
      id: 'rapid-guess',
      answer: () => 'correct',
      durationMs: 1_000,
    })

    expect(result.session.completionReason).toBe('response-quality-limit')
    expect(result.session.estimate.rapidGuessCount).toBe(4)
    expect(result.session.estimate.reliableEvidenceCount).toBe(0)
  })

  it('hard-stops at fifteen minutes without entering another domain', () => {
    const session = createVocabularyAssessmentSessionV2({
      id: 'hard-limit',
      startedAt: iso(0),
      bank: vocabularyPlacementBankV2,
    })
    const stopped = getNextVocabularyAssessmentItemV2(
      session,
      vocabularyPlacementBankV2,
      iso(15 * 60_000),
    ).session

    expect(stopped.status).toBe('partial')
    expect(stopped.phase).toBe('complete')
    expect(stopped.completionReason).toBe('time-limit')
    expect(stopped.responses).toHaveLength(0)
  })
})
