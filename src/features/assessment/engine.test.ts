import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import {
  createAssessmentSession,
  getNextAssessmentItem,
  stopAssessment,
  submitAssessmentResponse,
} from './engine.ts'
import { buildAbilityProfile } from './profile.ts'
import type {
  AssessmentSession,
  AssessmentSubmission,
  PublicAssessmentItem,
} from './types.ts'

const start = Date.parse('2026-07-24T08:00:00.000Z')

function iso(offsetMs: number): string {
  return new Date(start + offsetMs).toISOString()
}

function correctSubmission(
  item: PublicAssessmentItem,
  durationMs = 20_000,
): AssessmentSubmission {
  const privateItem = placementBankV1.items.find(
    (candidate) => candidate.id === item.id,
  )
  if (!privateItem) {
    throw new Error(`Missing private item ${item.id}`)
  }

  if (privateItem.kind === 'choice') {
    return {
      kind: 'choice',
      selectedOptionId: privateItem.scoring.correctOptionId,
      durationMs,
    }
  }

  return {
    kind: 'speech',
    durationMs,
    observation: {
      status: 'scored',
      transcript: privateItem.scoring.referenceText ?? 'complete response',
      metrics: {
        completeness: 0.95,
        intelligibility: 0.9,
        fluency: 0.85,
        languageControl: 0.85,
        taskCompletion: 0.9,
        recognitionConfidence: 0.9,
      },
    },
  }
}

function incorrectSubmission(
  item: PublicAssessmentItem,
): AssessmentSubmission {
  const privateItem = placementBankV1.items.find(
    (candidate) => candidate.id === item.id,
  )
  if (!privateItem) {
    throw new Error(`Missing private item ${item.id}`)
  }

  if (privateItem.kind === 'choice') {
    const wrongOption = privateItem.options.find(
      (option) => option.id !== privateItem.scoring.correctOptionId,
    )
    if (!wrongOption) {
      throw new Error(`Missing wrong option for ${item.id}`)
    }
    return {
      kind: 'choice',
      selectedOptionId: wrongOption.id,
      durationMs: 20_000,
    }
  }

  return {
    kind: 'speech',
    durationMs: 20_000,
    observation: {
      status: 'scored',
      transcript: 'unrelated response',
      metrics: {
        completeness: 0,
        intelligibility: 0,
        fluency: 0,
        languageControl: 0,
        taskCompletion: 0,
        recognitionConfidence: 0.9,
      },
    },
  }
}

function runCorrectlyToCompletion(): AssessmentSession {
  let session = createAssessmentSession({
    id: 'session-complete',
    startedAt: iso(0),
    bank: placementBankV1,
  })
  let elapsed = 0

  for (let index = 0; index < 40; index += 1) {
    const next = getNextAssessmentItem(session, placementBankV1, iso(elapsed))
    session = next.session
    if (!next.item) {
      return session
    }

    elapsed += 20_000
    session = submitAssessmentResponse({
      session,
      bank: placementBankV1,
      submission: correctSubmission(next.item),
      submittedAt: iso(elapsed),
    }).session
  }

  throw new Error('Assessment did not stop within the expected item limit')
}

function runIncorrectlyToCompletion(): AssessmentSession {
  let session = createAssessmentSession({
    id: 'session-low-boundary',
    startedAt: iso(0),
    bank: placementBankV1,
  })
  let elapsed = 0

  for (let index = 0; index < 40; index += 1) {
    const next = getNextAssessmentItem(session, placementBankV1, iso(elapsed))
    session = next.session
    if (!next.item) {
      return session
    }

    elapsed += 20_000
    session = submitAssessmentResponse({
      session,
      bank: placementBankV1,
      submission: incorrectSubmission(next.item),
      submittedAt: iso(elapsed),
    }).session
  }

  throw new Error('Assessment did not stop within the expected item limit')
}

function runToSpeaking(): {
  readonly session: AssessmentSession
  readonly elapsed: number
} {
  let session = createAssessmentSession({
    id: 'session-speaking-failure',
    startedAt: iso(0),
    bank: placementBankV1,
  })
  let elapsed = 0

  for (let index = 0; index < 30; index += 1) {
    const next = getNextAssessmentItem(session, placementBankV1, iso(elapsed))
    session = next.session
    if (session.phase === 'speaking') {
      return { session, elapsed }
    }
    if (!next.item) {
      throw new Error('Assessment ended before speaking')
    }

    elapsed += 15_000
    session = submitAssessmentResponse({
      session,
      bank: placementBankV1,
      submission: correctSubmission(next.item, 15_000),
      submittedAt: iso(elapsed),
    }).session
  }

  throw new Error('Assessment did not reach speaking')
}

describe('adaptive assessment engine', () => {
  it('completes all three independent domains within the item caps', () => {
    const session = runCorrectlyToCompletion()

    expect(session.status).toBe('completed')
    expect(session.completionReason).toBe('all-domains-stopped')
    expect(session.estimates.vocabulary.attemptedCount).toBeLessThanOrEqual(12)
    expect(session.estimates.listening.attemptedCount).toBeLessThanOrEqual(9)
    expect(session.estimates.speaking.attemptedCount).toBeLessThanOrEqual(6)
    expect(new Set(session.responses.map((response) => response.itemId)).size)
      .toBe(session.responses.length)

    const profile = buildAbilityProfile({
      session,
      completedAt: iso(10 * 60_000),
    })
    expect(profile.disclaimer).toContain('不是官方认证')
    expect(profile.abilities.vocabulary.internalLevel).not.toBeNull()
    expect(profile.abilities.listening.internalLevel).not.toBeNull()
    expect(profile.abilities.speaking.internalLevel).not.toBeNull()
  })

  it('does not use vocabulary performance as the listening prior', () => {
    let session = createAssessmentSession({
      id: 'independence',
      startedAt: iso(0),
      bank: placementBankV1,
    })
    let elapsed = 0
    let firstListeningDifficulty: number | null = null

    for (let index = 0; index < 20; index += 1) {
      const next = getNextAssessmentItem(session, placementBankV1, iso(elapsed))
      session = next.session
      if (!next.item) {
        break
      }
      if (next.item.domain === 'listening') {
        firstListeningDifficulty = next.item.difficulty
        break
      }

      elapsed += 15_000
      session = submitAssessmentResponse({
        session,
        bank: placementBankV1,
        submission: correctSubmission(next.item, 15_000),
        submittedAt: iso(elapsed),
      }).session
    }

    expect(session.estimates.vocabulary.level).toBeGreaterThan(8)
    expect(session.estimates.listening.level).toBe(5.5)
    expect(firstListeningDifficulty).toBeGreaterThanOrEqual(4)
    expect(firstListeningDifficulty).toBeLessThanOrEqual(7)
  })

  it('marks measured floor and ceiling results as censored', () => {
    const high = buildAbilityProfile({
      session: runCorrectlyToCompletion(),
      completedAt: iso(10 * 60_000),
    })
    const low = buildAbilityProfile({
      session: runIncorrectlyToCompletion(),
      completedAt: iso(10 * 60_000),
    })

    expect(high.abilities.vocabulary.boundary).toBe('upper-censored')
    expect(high.abilities.vocabulary.warnings.join(' ')).toContain(
      '不能据此证明达到官方 C2',
    )
    expect(low.abilities.vocabulary.boundary).toBe('lower-censored')
  })

  it('stops speaking after repeated unscorable recognition and reports unknown', () => {
    let { session, elapsed } = runToSpeaking()

    for (let failure = 0; failure < 2; failure += 1) {
      const next = getNextAssessmentItem(session, placementBankV1, iso(elapsed))
      session = next.session
      if (!next.item) {
        throw new Error('Expected a speaking item')
      }
      elapsed += 10_000
      session = submitAssessmentResponse({
        session,
        bank: placementBankV1,
        submission: {
          kind: 'speech',
          durationMs: 10_000,
          observation: {
            status: 'unscorable',
            reason: 'recognition-failed',
            recordingAvailable: true,
          },
        },
        submittedAt: iso(elapsed),
      }).session
    }

    session = getNextAssessmentItem(
      session,
      placementBankV1,
      iso(elapsed),
    ).session
    expect(session.status).toBe('completed')
    expect(session.estimates.speaking.status).toBe('unavailable')

    const profile = buildAbilityProfile({
      session,
      completedAt: iso(elapsed),
    })
    expect(profile.outcome).toBe('partial')
    expect(profile.abilities.speaking.cefrEstimate).toBe('unknown')
    expect(profile.abilities.speaking.internalLevel).toBeNull()
  })

  it('hard-stops at twenty minutes without inventing evidence', () => {
    const session = createAssessmentSession({
      id: 'time-limit',
      startedAt: iso(0),
      bank: placementBankV1,
    })
    const stopped = getNextAssessmentItem(
      session,
      placementBankV1,
      iso(20 * 60_000),
    ).session
    const profile = buildAbilityProfile({
      session: stopped,
      completedAt: iso(20 * 60_000),
    })

    expect(stopped.status).toBe('partial')
    expect(stopped.completionReason).toBe('time-limit')
    expect(profile.abilities.vocabulary.cefrEstimate).toBe('unknown')
    expect(profile.abilities.listening.cefrEstimate).toBe('unknown')
    expect(profile.abilities.speaking.cefrEstimate).toBe('unknown')
  })

  it('supports an explicit user stop as a partial result', () => {
    const session = stopAssessment(
      createAssessmentSession({
        id: 'user-stop',
        startedAt: iso(0),
        bank: placementBankV1,
      }),
    )

    expect(session.status).toBe('partial')
    expect(session.completionReason).toBe('user-stopped')
  })
})
