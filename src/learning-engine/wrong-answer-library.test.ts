import { describe, expect, it } from 'vitest'
import {
  advanceWrongAnswerReviewRound,
  applyWrongAnswerEvidence,
  assertRecoverableWrongAnswerReviewRound,
  createWrongAnswerLibraryState,
  randomizeWrongAnswerRecordIds,
  startWrongAnswerReviewRound,
  submitWrongAnswerReviewAnswer,
} from './wrong-answer-library.ts'

function evidence(overrides: Partial<Parameters<typeof applyWrongAnswerEvidence>[1]> = {}) {
  return {
    schemaVersion: 1 as const, eventId: 'event-1', occurredAt: '2026-08-03T00:00:00.000Z',
    reviewContentId: 'content-a', originalQuestionType: 'multiple-choice', domain: 'vocabulary' as const,
    source: 'daily-training' as const, outcome: 'incorrect' as const, formallyScored: true,
    ...overrides,
  }
}

describe('R13-D unified wrong-answer library', () => {
  it('deduplicates formal errors across sources but never merges question types', () => {
    const first = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence())
    const duplicate = applyWrongAnswerEvidence(first.state, evidence())
    const second = applyWrongAnswerEvidence(first.state, evidence({ eventId: 'event-2', source: 'scenario-training' }))
    const distinct = applyWrongAnswerEvidence(second.state, evidence({ eventId: 'event-3', originalQuestionType: 'keyword-dictation' }))
    expect(duplicate.reason).toBe('duplicate')
    expect(second.record?.incorrectCount).toBe(2)
    expect(second.record?.sources).toEqual(['daily-training', 'scenario-training'])
    expect(Object.keys(distinct.state.records)).toHaveLength(2)
  })

  it('ignores unscorable and ordinary correct evidence without changing library facts', () => {
    const empty = createWrongAnswerLibraryState()
    expect(applyWrongAnswerEvidence(empty, evidence({ outcome: 'unscorable', formallyScored: false })).reason).toBe('ignored-unscorable')
    expect(applyWrongAnswerEvidence(empty, evidence({ outcome: 'correct', formallyScored: true })).reason).toBe('ignored-correct')
    expect(() => applyWrongAnswerEvidence(empty, evidence({ formallyScored: false }))).toThrow('formally scored')
  })

  it('uses deterministic random rounds and preserves an empty or single-item round', () => {
    expect(randomizeWrongAnswerRecordIds([], 'seed')).toEqual([])
    expect(randomizeWrongAnswerRecordIds(['a'], 'seed')).toEqual(['a'])
    expect(randomizeWrongAnswerRecordIds(['c', 'a', 'b'], 'seed')).toEqual(randomizeWrongAnswerRecordIds(['b', 'c', 'a'], 'seed'))
    const state = startWrongAnswerReviewRound(createWrongAnswerLibraryState(), { roundId: 'round-empty', seed: 'seed', startedAt: '2026-08-03T00:00:00.000Z' })
    expect(state.activeRound?.status).toBe('completed')
  })

  it('keeps an in-progress order through JSON recovery and does not add new errors to it', () => {
    let state = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    state = startWrongAnswerReviewRound(state, { roundId: 'round-json', seed: 'seed-json', startedAt: '2026-08-03T00:00:01.000Z' })
    const persisted = JSON.parse(JSON.stringify(state)) as typeof state
    const withNewError = applyWrongAnswerEvidence(persisted, evidence({ eventId: 'new-error', reviewContentId: 'content-b', occurredAt: '2026-08-03T00:00:02.000Z' })).state
    expect(assertRecoverableWrongAnswerReviewRound(withNewError)?.order).toEqual(state.activeRound?.order)
  })

  it('moves an item to history only after two dedicated review answers, then reactivates it on later formal error', () => {
    let state = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    state = startWrongAnswerReviewRound(state, { roundId: 'round-1', seed: 'seed-1', startedAt: '2026-08-03T00:00:01.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'review-1', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:02.000Z' })).state
    state = advanceWrongAnswerReviewRound(state, '2026-08-03T00:00:03.000Z')
    expect(Object.values(state.records)[0]?.consecutiveReviewCorrect).toBe(1)
    state = startWrongAnswerReviewRound({ ...state, activeRound: null }, { roundId: 'round-2', seed: 'seed-2', startedAt: '2026-08-03T00:00:04.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'review-2', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:05.000Z' })).state
    expect(Object.values(state.records)[0]?.status).toBe('history')
    state = applyWrongAnswerEvidence(state, evidence({ eventId: 'later-error', occurredAt: '2026-08-03T00:00:06.000Z', source: 'extra-training' })).state
    expect(Object.values(state.records)[0]).toMatchObject({ status: 'active', consecutiveReviewCorrect: 0, incorrectCount: 2 })
  })

  it('rejects time reversal and corrupted or drifting persisted rounds', () => {
    const first = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    expect(() => applyWrongAnswerEvidence(first, evidence({ eventId: 'older', occurredAt: '2026-08-02T00:00:00.000Z' }))).toThrow('predate')
    const round = startWrongAnswerReviewRound(first, { roundId: 'round', seed: 'seed', startedAt: '2026-08-03T00:00:01.000Z' })
    expect(() => assertRecoverableWrongAnswerReviewRound({ ...round, activeRound: { ...round.activeRound!, order: ['missing'] } })).toThrow('identity drift')
  })
})
