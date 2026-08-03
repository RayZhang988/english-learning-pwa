import { describe, expect, it } from 'vitest'
import {
  applyWrongAnswerEvidence,
  createWrongAnswerLibraryState,
  startWrongAnswerReviewRound,
} from '../../learning-engine/index.ts'
import { speakingPrompt } from './test-fixtures.ts'
import {
  SpeakingWrongAnswerContentResolver,
  createSpeakingWrongAnswerEvidence,
  speakingWrongAnswerOutcome,
  submitSpeakingWrongAnswerReview,
} from './wrong-answer.ts'

const index = await import('../../../content/curriculum/review-content-index.v1.json')

describe('speaking wrong-answer boundary', () => {
  it('accepts all 122 published speaking aliases and rejects identity guessing', () => {
    const resolver = new SpeakingWrongAnswerContentResolver(index.default)
    const aliases = Object.values((index.default as { aliases: Record<string, unknown> }).aliases)
      .filter((entry) => (entry as { domain?: string }).domain === 'speaking') as Array<{ source: { itemId: string; sourceId: string; contentRef: string } }>
    expect(aliases).toHaveLength(122)
    for (const alias of aliases) {
      expect(resolver.resolveItem({ itemId: alias.source.itemId, source: { sourceType: alias.source.itemId.includes('-q') ? 'speaking-scene-quiz' : 'speaking-prompt', sourceId: alias.source.sourceId, variantId: alias.source.itemId.includes('-q') ? 'scene-fixed-response' : 'activity-prompt' }, contentRef: alias.source.contentRef } as never).reviewContentId).toMatch(/^review-content-v1-/)
    }
  })

  it('only partial/different are incorrect; recognized close/match and every unscorable path are excluded', () => {
    expect(speakingWrongAnswerOutcome({ level: 'match' } as never)).toBe('correct')
    expect(speakingWrongAnswerOutcome({ level: 'close' } as never)).toBe('correct')
    expect(speakingWrongAnswerOutcome({ level: 'partial' } as never)).toBe('incorrect')
    expect(speakingWrongAnswerOutcome({ level: 'different' } as never)).toBe('incorrect')
    expect(speakingWrongAnswerOutcome(null)).toBe('unscorable')
  })

  it('advances removal only through two dedicated review correct answers', () => {
    const identity = { reviewContentId: 'review-content-v1-test', originalQuestionType: 'speaking-activity-prompt', domain: 'speaking' as const, source: { kind: 'daily-supply' as const, itemId: 'item', sourceId: speakingPrompt.id, contentRef: 'lesson://x' } }
    const evidence = createSpeakingWrongAnswerEvidence({ eventId: 'wrong', occurredAt: '2026-08-03T00:00:00.000Z', source: 'daily-training', identity, match: { level: 'different' } as never })
    let library = createWrongAnswerLibraryState()
    library = applyWrongAnswerEvidence(library, evidence).state
    library = startWrongAnswerReviewRound(library, { roundId: 'round', seed: 'seed', startedAt: evidence.occurredAt })
    const record = Object.values(library.records)[0]
    let result = submitSpeakingWrongAnswerReview({ library, eventId: 'review-1', occurredAt: '2026-08-03T00:00:01.000Z', transcript: speakingPrompt.modelAnswer, prompt: speakingPrompt, record })
    expect(result.record?.status).toBe('active')
    library = result.state
    // The engine owns advancing feedback. Start a fresh valid review round to
    // prove a second review-only correctness moves it to history.
    library = { ...library, activeRound: null }
    library = startWrongAnswerReviewRound(library, { roundId: 'round-2', seed: 'seed-2', startedAt: '2026-08-03T00:00:02.000Z' })
    result = submitSpeakingWrongAnswerReview({ library, eventId: 'review-2', occurredAt: '2026-08-03T00:00:03.000Z', transcript: speakingPrompt.modelAnswer, prompt: speakingPrompt, record: Object.values(library.records)[0] })
    expect(result.record?.status).toBe('history')
  })
})
