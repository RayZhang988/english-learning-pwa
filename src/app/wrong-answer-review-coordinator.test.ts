import { describe, expect, it } from 'vitest'
import { applyWrongAnswerEvidence, assertWrongAnswerLibraryState, createWrongAnswerLibraryState, startWrongAnswerReviewRound, type WrongAnswerEvidence, type WrongAnswerLibraryState, type WrongAnswerLibraryStateTransform } from '../learning-engine/index.ts'
import { WrongAnswerReviewCoordinator } from './wrong-answer-review-coordinator.ts'

function wrong(id: string): WrongAnswerEvidence { return { schemaVersion: 1, eventId: `wrong-${id}`, occurredAt: '2026-08-10T00:00:00.000Z', domain: 'vocabulary', source: 'daily-training', reviewContentId: id, originalQuestionType: 'choice', outcome: 'incorrect', formallyScored: true } }
class State {
  state: WrongAnswerLibraryState
  fail = false
  constructor() { this.state = startWrongAnswerReviewRound(applyWrongAnswerEvidence(createWrongAnswerLibraryState(), wrong('one')).state, { roundId: 'round', seed: 'seed', startedAt: '2026-08-10T00:00:01.000Z' }) }
  async load() { if (this.fail) throw new Error('load failed'); return this.state }
  async update(transform: WrongAnswerLibraryStateTransform) { if (this.fail) throw new Error('save failed'); const next = transform(this.state); assertWrongAnswerLibraryState(next); this.state = next; return next }
}
const question = { identity: { reviewContentId: 'one', originalQuestionType: 'choice', domain: 'vocabulary' as const, source: {} }, questionId: 'q', correctOptionId: 'yes', prompt: 'passport', options: [{ id: 'yes', label: '护照' }, { id: 'no', label: '机票' }] }

describe('WrongAnswerReviewCoordinator', () => {
  it('persists a vocabulary draft, restores it, scores once, and completes the round', async () => {
    const state = new State(); const resolver = { resolve: async () => ({ kind: 'vocabulary' as const, question }) }
    const first = new WrongAnswerReviewCoordinator({ state, resolver, now: () => '2026-08-10T00:00:02.000Z' }); await first.initialize(); await first.selectVocabulary('yes')
    const restored = new WrongAnswerReviewCoordinator({ state, resolver, now: () => '2026-08-10T00:00:02.000Z' }); await restored.initialize()
    expect(restored.snapshot.active).toMatchObject({ kind: 'vocabulary', selectedOptionId: 'yes' })
    await restored.submit(); expect(state.state.activeRound?.stage).toBe('feedback'); expect(state.state.records['one::choice']?.consecutiveReviewCorrect).toBe(1)
    await restored.advance(); expect(state.state.activeRound?.status).toBe('completed'); expect(restored.snapshot.active).toBeNull()
  })
  it('keeps a concurrent wrong answer when the active answer commits', async () => {
    const state = new State(); const coordinator = new WrongAnswerReviewCoordinator({ state, resolver: { resolve: async () => ({ kind: 'vocabulary' as const, question }) }, now: () => '2026-08-10T00:00:02.000Z' })
    await coordinator.initialize(); await coordinator.selectVocabulary('yes'); state.state = applyWrongAnswerEvidence(state.state, wrong('concurrent')).state; await coordinator.submit()
    expect(state.state.records['concurrent::choice']?.incorrectCount).toBe(1)
  })
  it('exposes a retryable error without discarding the active question', async () => {
    const state = new State(); const coordinator = new WrongAnswerReviewCoordinator({ state, resolver: { resolve: async () => ({ kind: 'vocabulary' as const, question }) } }); await coordinator.initialize(); await coordinator.selectVocabulary('yes'); state.fail = true; await coordinator.submit()
    expect(coordinator.snapshot.status).toBe('error'); expect(coordinator.snapshot.active?.kind).toBe('vocabulary'); expect(state.state.activeRound?.stage).toBe('answering')
  })
  it('retains the durable round when released content cannot be resolved', async () => {
    const state = new State(); const coordinator = new WrongAnswerReviewCoordinator({ state, resolver: { resolve: async () => { throw new Error('offline content unavailable') } } })
    await coordinator.initialize()
    expect(coordinator.snapshot.status).toBe('error')
    expect(coordinator.snapshot.library?.activeRound?.roundId).toBe('round')
    expect(coordinator.snapshot.error?.message).toContain('offline')
  })
  it('surfaces a draft save failure while retaining the original question for retry', async () => {
    const state = new State(); const coordinator = new WrongAnswerReviewCoordinator({ state, resolver: { resolve: async () => ({ kind: 'vocabulary' as const, question }) } })
    await coordinator.initialize(); state.fail = true; await coordinator.selectVocabulary('yes')
    expect(coordinator.snapshot.status).toBe('error')
    expect(coordinator.snapshot.active).toMatchObject({ kind: 'vocabulary', selectedOptionId: null })
    expect(state.state.activeRound?.answerDraft).toBeNull()
  })
})
