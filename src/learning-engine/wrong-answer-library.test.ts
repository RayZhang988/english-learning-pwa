import { describe, expect, it } from 'vitest'
import {
  advanceWrongAnswerReviewRound,
  applyWrongAnswerEvidence,
  assertRecoverableWrongAnswerReviewRound,
  assertWrongAnswerLibraryState,
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
    expect(Object.values(state.records)[0]).toMatchObject({ movedToHistoryAt: null, lastReviewAttemptAt: null })
    state = startWrongAnswerReviewRound(state, { roundId: 'round-1', seed: 'seed-1', startedAt: '2026-08-03T00:00:01.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'review-1', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:02.000Z' })).state
    state = advanceWrongAnswerReviewRound(state, '2026-08-03T00:00:03.000Z')
    expect(Object.values(state.records)[0]).toMatchObject({ consecutiveReviewCorrect: 1, movedToHistoryAt: null, lastReviewAttemptAt: '2026-08-03T00:00:02.000Z' })
    state = startWrongAnswerReviewRound({ ...state, activeRound: null }, { roundId: 'round-2', seed: 'seed-2', startedAt: '2026-08-03T00:00:04.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'review-2', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:05.000Z' })).state
    expect(Object.values(state.records)[0]).toMatchObject({ status: 'history', movedToHistoryAt: '2026-08-03T00:00:05.000Z', lastReviewAttemptAt: '2026-08-03T00:00:05.000Z' })
    expect(() => applyWrongAnswerEvidence(state, evidence({ eventId: 'delayed-error', occurredAt: '2026-08-03T00:00:04.500Z', source: 'extra-training' }))).toThrow('latest wrong-answer fact')
    state = applyWrongAnswerEvidence(state, evidence({ eventId: 'later-error', occurredAt: '2026-08-03T00:00:06.000Z', source: 'extra-training' })).state
    expect(Object.values(state.records)[0]).toMatchObject({ status: 'active', consecutiveReviewCorrect: 0, incorrectCount: 2, movedToHistoryAt: null, lastReviewAttemptAt: '2026-08-03T00:00:05.000Z' })
  })

  it('keeps the history timestamp null when a dedicated review answer is incorrect', () => {
    let state = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    state = startWrongAnswerReviewRound(state, { roundId: 'round-wrong', seed: 'seed-wrong', startedAt: '2026-08-03T00:00:01.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'review-wrong', source: 'wrong-answer-review', outcome: 'incorrect', occurredAt: '2026-08-03T00:00:02.000Z' })).state
    expect(Object.values(state.records)[0]).toMatchObject({ status: 'active', consecutiveReviewCorrect: 0, movedToHistoryAt: null, lastReviewAttemptAt: '2026-08-03T00:00:02.000Z' })
  })

  it('rejects delayed errors after the first review correct while prioritizing idempotency and allowing equal-time facts', () => {
    let state = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    state = startWrongAnswerReviewRound(state, { roundId: 'round-order', seed: 'seed-order', startedAt: '2026-08-03T00:00:01.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'review-order', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:03.000Z' })).state
    expect(() => applyWrongAnswerEvidence(state, evidence({ eventId: 'delayed-after-first-correct', occurredAt: '2026-08-03T00:00:02.000Z' }))).toThrow('latest wrong-answer fact')
    const duplicate = applyWrongAnswerEvidence(state, evidence())
    expect(duplicate).toMatchObject({ reason: 'duplicate', state })
    const equalTime = applyWrongAnswerEvidence(state, evidence({ eventId: 'equal-time-error', occurredAt: '2026-08-03T00:00:03.000Z' }))
    expect(equalTime.record).toMatchObject({ status: 'active', consecutiveReviewCorrect: 0, lastIncorrectAt: '2026-08-03T00:00:03.000Z', lastReviewAttemptAt: '2026-08-03T00:00:03.000Z' })
  })

  it('rejects time reversal and corrupted or drifting persisted rounds', () => {
    const first = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    expect(() => applyWrongAnswerEvidence(first, evidence({ eventId: 'older', occurredAt: '2026-08-02T00:00:00.000Z' }))).toThrow('predate')
    const round = startWrongAnswerReviewRound(first, { roundId: 'round', seed: 'seed', startedAt: '2026-08-03T00:00:01.000Z' })
    expect(() => assertRecoverableWrongAnswerReviewRound({ ...round, activeRound: { ...round.activeRound!, order: ['missing'] } })).toThrow('identity drift')
  })

  it('strictly recovers a JSON round-trip with the exact history transition time', () => {
    let state = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    state = startWrongAnswerReviewRound(state, { roundId: 'round-json-history-1', seed: 'seed-json-history-1', startedAt: '2026-08-03T00:00:01.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'json-review-1', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:02.000Z' })).state
    state = advanceWrongAnswerReviewRound(state, '2026-08-03T00:00:03.000Z')
    state = startWrongAnswerReviewRound({ ...state, activeRound: null }, { roundId: 'round-json-history-2', seed: 'seed-json-history-2', startedAt: '2026-08-03T00:00:04.000Z' })
    state = submitWrongAnswerReviewAnswer(state, evidence({ eventId: 'json-review-2', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:05.000Z' })).state
    const recovered: unknown = JSON.parse(JSON.stringify(state))
    assertWrongAnswerLibraryState(recovered)
    expect(Object.values(recovered.records)[0]?.movedToHistoryAt).toBe('2026-08-03T00:00:05.000Z')
  })

  it('rejects pre-release snapshots missing movedToHistoryAt instead of inventing history evidence', () => {
    const active = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    const recordId = Object.keys(active.records)[0]!
    const history = {
      ...active,
      records: { ...active.records, [recordId]: { ...active.records[recordId]!, status: 'history' as const, consecutiveReviewCorrect: 2 as const, movedToHistoryAt: '2026-08-03T00:00:01.000Z' } },
    }
    const oldSnapshot = JSON.parse(JSON.stringify(history)) as { records: Record<string, Record<string, unknown>> }
    const record = Object.values(oldSnapshot.records)[0]!
    delete record.movedToHistoryAt
    expect(() => assertWrongAnswerLibraryState(oldSnapshot)).toThrow('movedToHistoryAt')
    expect(record).not.toHaveProperty('movedToHistoryAt')
  })

  it('rejects corrupt active/history timestamp invariants during JSON recovery', () => {
    const active = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    const activeRecordId = Object.keys(active.records)[0]!
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [activeRecordId]: { ...active.records[activeRecordId]!, movedToHistoryAt: '2026-08-03T00:00:01.000Z' } },
    })).toThrow('active')
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [activeRecordId]: { ...active.records[activeRecordId]!, status: 'history', consecutiveReviewCorrect: 2, movedToHistoryAt: null } },
    })).toThrow('history')
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [activeRecordId]: { ...active.records[activeRecordId]!, status: 'history', consecutiveReviewCorrect: 2, movedToHistoryAt: 'not-a-time' } },
    })).toThrow('movedToHistoryAt')
  })

  it('strictly requires coherent persisted review fact timestamps', () => {
    const active = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    const recordId = Object.keys(active.records)[0]!
    const missing = JSON.parse(JSON.stringify(active)) as { records: Record<string, Record<string, unknown>> }
    delete missing.records[recordId]!.lastReviewAttemptAt
    expect(() => assertWrongAnswerLibraryState(missing)).toThrow('lastReviewAttemptAt')
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [recordId]: { ...active.records[recordId]!, lastReviewAttemptAt: 'not-a-time' } },
    })).toThrow('lastReviewAttemptAt')
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [recordId]: { ...active.records[recordId]!, consecutiveReviewCorrect: 1, lastReviewAttemptAt: null } },
    })).toThrow('review streak')
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [recordId]: { ...active.records[recordId]!, status: 'history', consecutiveReviewCorrect: 2, lastReviewAttemptAt: '2026-08-03T00:00:01.000Z', movedToHistoryAt: '2026-08-03T00:00:02.000Z' } },
    })).toThrow('history transition')
  })

  it('rejects non-enum sources and sparse persisted arrays', () => {
    const active = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    const recordId = Object.keys(active.records)[0]!
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [recordId]: { ...active.records[recordId]!, sources: ['daily-training', 'manual-import'] } },
    })).toThrow('sources')
    const sparseSources = new Array<string>(2)
    sparseSources[1] = 'daily-training'
    expect(() => assertWrongAnswerLibraryState({
      ...active,
      records: { ...active.records, [recordId]: { ...active.records[recordId]!, sources: sparseSources } },
    })).toThrow('dense')
    const sparseEvidenceIds = new Array<string>(2)
    sparseEvidenceIds[1] = 'event-1'
    expect(() => assertWrongAnswerLibraryState({ ...active, processedEvidenceIds: sparseEvidenceIds })).toThrow('dense')
    const round = startWrongAnswerReviewRound(active, { roundId: 'round-sparse', seed: 'seed-sparse', startedAt: '2026-08-03T00:00:01.000Z' })
    const sparseOrder = new Array<string>(2)
    sparseOrder[1] = recordId
    expect(() => assertWrongAnswerLibraryState({
      ...round,
      activeRound: { ...round.activeRound!, order: sparseOrder, index: 2, answeredCount: 2, status: 'completed' },
    })).toThrow('dense')
  })

  it('enforces round terminal-status invariants without rejecting valid recovery checkpoints', () => {
    const active = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence()).state
    const running = startWrongAnswerReviewRound(active, { roundId: 'round-status', seed: 'seed-status', startedAt: '2026-08-03T00:00:01.000Z' })
    expect(() => assertWrongAnswerLibraryState(running)).not.toThrow()
    expect(() => assertWrongAnswerLibraryState({ ...running, activeRound: { ...running.activeRound!, status: 'exited' } })).not.toThrow()
    expect(() => assertWrongAnswerLibraryState({ ...running, activeRound: { ...running.activeRound!, status: 'failed', failure: 'identity-drift' } })).not.toThrow()
    expect(() => assertWrongAnswerLibraryState({ ...running, activeRound: { ...running.activeRound!, status: 'completed' } })).toThrow('completed')
    expect(() => assertWrongAnswerLibraryState({ ...running, activeRound: { ...running.activeRound!, status: 'failed' } })).toThrow('failed')
    expect(() => assertWrongAnswerLibraryState({ ...running, activeRound: { ...running.activeRound!, failure: 'identity-drift' } })).toThrow('failure')
    let completed = submitWrongAnswerReviewAnswer(running, evidence({ eventId: 'round-status-correct', source: 'wrong-answer-review', outcome: 'correct', occurredAt: '2026-08-03T00:00:02.000Z' })).state
    completed = advanceWrongAnswerReviewRound(completed, '2026-08-03T00:00:03.000Z')
    expect(() => assertWrongAnswerLibraryState(completed)).not.toThrow()
    expect(() => assertWrongAnswerLibraryState({ ...completed, activeRound: { ...completed.activeRound!, status: 'active' } })).toThrow('active')
    expect(() => assertWrongAnswerLibraryState({ ...completed, activeRound: { ...completed.activeRound!, stage: 'feedback', answeredCount: 2 } })).toThrow('feedback')
    expect(() => assertWrongAnswerLibraryState({ ...running, processedEvidenceIds: ['event-1', 'event-1'] })).toThrow('processedEvidenceIds')
    expect(() => assertWrongAnswerLibraryState({ ...running, activeRound: { ...running.activeRound!, order: [running.activeRound!.order[0]!, running.activeRound!.order[0]!] } })).toThrow('order')
  })
})
