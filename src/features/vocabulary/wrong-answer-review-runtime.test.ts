import { describe, expect, it } from 'vitest'
import { applyWrongAnswerEvidence, assertWrongAnswerLibraryState, createWrongAnswerLibraryState, startWrongAnswerReviewRound, type WrongAnswerLibraryState, type WrongAnswerLibraryStateTransform } from '../../learning-engine/index.ts'
import { VocabularyWrongAnswerReviewRuntime } from './wrong-answer-review-runtime.ts'

function evidence(id: string) { return { schemaVersion: 1 as const, eventId: `bad-${id}`, reviewContentId: `content-${id}`, originalQuestionType: 'vocabulary-term-to-meaning-choice', domain: 'vocabulary' as const, source: 'daily-training' as const, outcome: 'incorrect' as const, formallyScored: true, occurredAt: '2026-08-03T00:00:00.000Z' } }
class Port { state: WrongAnswerLibraryState; fail = false; constructor(state: WrongAnswerLibraryState) { this.state = state } async load() { return this.state } async update(transform: WrongAnswerLibraryStateTransform) { if (this.fail) throw new Error('save failed'); const next = transform(this.state); assertWrongAnswerLibraryState(next); this.state = next; return next } }
function setup() { let state = applyWrongAnswerEvidence(createWrongAnswerLibraryState(), evidence('a')).state; state = startWrongAnswerReviewRound(state, { roundId: 'round', seed: 'seed', startedAt: '2026-08-03T00:00:01.000Z' }); const port = new Port(state); return { port, runtime: new VocabularyWrongAnswerReviewRuntime({ state: port, now: () => '2026-08-03T00:00:02.000Z', resolve: async (identity) => ({ identity: { ...identity, domain: 'vocabulary' as const, source: {} }, questionId: 'q', correctOptionId: 'yes', prompt: 'prompt', options: [{ id: 'yes', label: 'yes' }, { id: 'no', label: 'no' }] }) }) } }
describe('VocabularyWrongAnswerReviewRuntime', () => {
  it('resolves randomized current item, persists feedback, advances, and removes after two review correct answers', async () => {
    const { runtime, port } = setup(); await runtime.initialize(); expect((await runtime.currentQuestion())?.questionId).toBe('q'); await runtime.submit('yes'); expect(port.state.activeRound?.stage).toBe('feedback'); await runtime.advance(); expect(port.state.records['content-a::vocabulary-term-to-meaning-choice']?.consecutiveReviewCorrect).toBe(1)
    port.state = startWrongAnswerReviewRound({ ...port.state, activeRound: null }, { roundId: 'round-2', seed: 'seed', startedAt: '2026-08-03T00:00:03.000Z' }); const second = new VocabularyWrongAnswerReviewRuntime({ state: port, now: () => '2026-08-03T00:00:04.000Z', resolve: async (identity) => ({ identity: { ...identity, domain: 'vocabulary' as const, source: {} }, questionId: 'q', correctOptionId: 'yes', prompt: 'prompt', options: [] }) }); await second.initialize(); await second.submit('yes'); expect(port.state.records['content-a::vocabulary-term-to-meaning-choice']?.status).toBe('history')
  })
  it('does not silently advance in-memory state when the state store fails', async () => { const { runtime, port } = setup(); await runtime.initialize(); port.fail = true; await expect(runtime.submit('no')).rejects.toThrow('save failed'); expect(port.state.activeRound?.stage).toBe('answering') })
  it('applies review evidence to the latest durable state without overwriting concurrent records', async () => {
    const { runtime, port } = setup(); await runtime.initialize()
    port.state = applyWrongAnswerEvidence(port.state, evidence('concurrent')).state
    await runtime.submit('yes')
    expect(port.state.records['content-concurrent::vocabulary-term-to-meaning-choice']?.status).toBe('active')
    expect(port.state.records['content-a::vocabulary-term-to-meaning-choice']?.consecutiveReviewCorrect).toBe(1)
  })
})
