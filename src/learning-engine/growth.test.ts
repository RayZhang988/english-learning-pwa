import { describe, expect, it } from 'vitest'
import {
  applyGrowthTrainingCompleted,
  assertGrowthState,
  applyGrowthEvent,
  createGrowthState,
  getGrowthEligibility,
  migrateGrowthState,
  startGrowthUpgradeTest,
  submitGrowthUpgradeAnswer,
} from './growth.ts'

const at = (n: number) => `2026-08-${String(n).padStart(2, '0')}T12:00:00.000Z`

function completedSession(id: string, day: number, correct = 10, incorrect = 0) {
  return {
    eventId: `event-${id}`,
    source: 'daily-training' as const,
    sessionId: id,
    domain: 'vocabulary' as const,
    levelOrdinal: 0,
    correctCount: correct,
    incorrectCount: incorrect,
    localDate: `2026-08-${String(day).padStart(2, '0')}`,
    completedAt: at(day),
  }
}

describe('growth progression', () => {
  it('becomes eligible only after five formal sessions, 50 scored answers and 80% recent accuracy', () => {
    let state = createGrowthState()
    for (let index = 1; index <= 5; index += 1) {
      state = applyGrowthTrainingCompleted(state, completedSession(`s${index}`, index))
    }

    expect(getGrowthEligibility(state, 'vocabulary')).toMatchObject({
      status: 'eligible',
      progressPercent: 100,
      recentSessionCount: 5,
      levelScoredItemCount: 50,
      recentAccuracyPercent: 100,
    })
  })

  it('excludes unscorable work by refusing zero-scored summaries', () => {
    expect(() => applyGrowthTrainingCompleted(createGrowthState(), {
      ...completedSession('unscorable', 1, 0, 0),
    })).toThrow('scored')
  })

  it('uses a deterministic ten-question test and requires eight correct answers', () => {
    let state = createGrowthState()
    for (let index = 1; index <= 5; index += 1) {
      state = applyGrowthTrainingCompleted(state, completedSession(`s${index}`, index))
    }
    state = startGrowthUpgradeTest(state, {
      eventId: 'start-1', domain: 'vocabulary', seed: 42,
      candidateItemIds: Array.from({ length: 12 }, (_, index) => `item-${index}`),
      startedAt: at(10),
    })
    const firstOrder = state.domains.vocabulary.upgradeTest?.itemIds
    expect(firstOrder).toHaveLength(10)

    for (let index = 0; index < 8; index += 1) {
      state = submitGrowthUpgradeAnswer(state, {
        eventId: `answer-${index}`, domain: 'vocabulary', index, correct: true, answeredAt: at(11),
      })
    }
    expect(state.domains.vocabulary.currentLevelOrdinal).toBe(0)
    for (let index = 8; index < 10; index += 1) {
      state = submitGrowthUpgradeAnswer(state, {
        eventId: `answer-${index}`, domain: 'vocabulary', index, correct: false, answeredAt: at(11),
      })
    }
    expect(state.domains.vocabulary.currentLevelOrdinal).toBe(1)
    expect(state.domains.vocabulary.levelScoredItemCount).toBe(0)
  })

  it('does not downgrade after a failed test and waits for two later sessions before retry', () => {
    let state = createGrowthState()
    for (let index = 1; index <= 5; index += 1) state = applyGrowthTrainingCompleted(state, completedSession(`s${index}`, index))
    state = startGrowthUpgradeTest(state, { eventId: 'start', domain: 'vocabulary', seed: 1, candidateItemIds: Array.from({ length: 10 }, (_, i) => `i-${i}`), startedAt: at(10) })
    for (let index = 0; index < 10; index += 1) state = submitGrowthUpgradeAnswer(state, { eventId: `a-${index}`, domain: 'vocabulary', index, correct: false, answeredAt: at(11) })
    expect(getGrowthEligibility(state, 'vocabulary').status).toBe('cooling-down')
    state = applyGrowthTrainingCompleted(state, completedSession('later-1', 12))
    state = applyGrowthTrainingCompleted(state, completedSession('later-2', 13))
    expect(getGrowthEligibility(state, 'vocabulary').status).toBe('eligible')
  })

  it('keeps progress, session cadence and accuracy as separate eligibility signals', () => {
    let state = createGrowthState()
    state = applyGrowthTrainingCompleted(state, completedSession('bulk', 1, 40, 10))
    expect(getGrowthEligibility(state, 'vocabulary')).toMatchObject({
      status: 'ineligible', progressPercent: 100, recentSessionCount: 1, recentAccuracyPercent: 80,
    })
    for (let index = 2; index <= 5; index += 1) state = applyGrowthTrainingCompleted(state, completedSession(`low-${index}`, index, 0, 1))
    expect(getGrowthEligibility(state, 'vocabulary')).toMatchObject({
      status: 'ineligible', progressPercent: 100, recentSessionCount: 5,
    })
  })

  it('keeps domains isolated and rejects a stale-level or excluded summary at the narrow boundary', () => {
    let state = createGrowthState()
    state = applyGrowthTrainingCompleted(state, { ...completedSession('listen', 1), domain: 'listening' })
    expect(state.domains.vocabulary.levelScoredItemCount).toBe(0)
    expect(state.domains.listening.levelScoredItemCount).toBe(10)
    expect(() => applyGrowthTrainingCompleted(state, { ...completedSession('scene', 2), source: 'scenario-training' as never })).toThrow('source')
    expect(() => applyGrowthTrainingCompleted(state, { ...completedSession('stale', 2), levelOrdinal: 1 })).toThrow('does not match')
  })

  it('is idempotent for duplicate events, but rejects conflicting reused session identities', () => {
    const session = completedSession('same', 1)
    const once = applyGrowthTrainingCompleted(createGrowthState(), session)
    expect(applyGrowthTrainingCompleted(once, session)).toBe(once)
    expect(() => applyGrowthTrainingCompleted(once, { ...session, eventId: 'other-event', correctCount: 9, incorrectCount: 1 })).toThrow('conflicts')
  })

  it('persists ordered item identity, draft, feedback and score across offline-style recovery', () => {
    let state = createGrowthState()
    for (let index = 1; index <= 5; index += 1) state = applyGrowthTrainingCompleted(state, completedSession(`s${index}`, index))
    state = startGrowthUpgradeTest(state, { eventId: 'start', domain: 'vocabulary', seed: 9, candidateItemIds: Array.from({ length: 11 }, (_, index) => `next-${index}`), startedAt: at(10) })
    const order = state.domains.vocabulary.upgradeTest!.itemIds
    state = submitGrowthUpgradeAnswer(state, { eventId: 'a0', domain: 'vocabulary', index: 0, correct: true, draft: 'my answer', answeredAt: at(11) })
    const restored = JSON.parse(JSON.stringify(state))
    assertGrowthState(restored)
    expect(restored.domains.vocabulary.upgradeTest).toMatchObject({ itemIds: order, score: { correctCount: 1, answeredCount: 1 }, answers: [{ itemId: order[0], draft: 'my answer', feedback: { correct: true } }] })
    expect(submitGrowthUpgradeAnswer(restored, { eventId: 'a0', domain: 'vocabulary', index: 0, correct: true, draft: 'my answer', answeredAt: at(11) })).toBe(restored)
  })

  it('migrates a valid v1 snapshot without changing stable test order, and rejects corruption', () => {
    let v1: any = createGrowthState()
    v1.schemaVersion = 1
    v1.domains.vocabulary.upgradeTest = { schemaVersion: 1, testId: 'legacy-test', seed: 3, itemIds: Array.from({ length: 10 }, (_, index) => `legacy-${index}`), answers: [true, false], startedAt: at(1) }
    const migrated = migrateGrowthState(v1)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.domains.vocabulary.upgradeTest).toMatchObject({ schemaVersion: 2, itemIds: v1.domains.vocabulary.upgradeTest.itemIds, score: { correctCount: 1, answeredCount: 2 } })
    expect(() => assertGrowthState({ ...migrated, domains: { ...migrated.domains, vocabulary: { ...migrated.domains.vocabulary, upgradeTest: { ...migrated.domains.vocabulary.upgradeTest!, score: { correctCount: 2, answeredCount: 2 } } } } })).toThrow('score')
  })

  it('rejects an out-of-order answer event instead of guessing its course answer', () => {
    let state = createGrowthState()
    for (let index = 1; index <= 5; index += 1) state = applyGrowthEvent(state, { type: 'learning.growth.training.completed.v1', payload: completedSession(`e${index}`, index) })
    state = applyGrowthEvent(state, { type: 'learning.growth.upgrade-test.started.v1', payload: { eventId: 'start', domain: 'vocabulary', seed: 4, candidateItemIds: Array.from({ length: 10 }, (_, index) => `id-${index}`), startedAt: at(8) } })
    expect(() => applyGrowthEvent(state, { type: 'learning.growth.upgrade-test.answer.recorded.v1', payload: { eventId: 'late', domain: 'vocabulary', index: 1, correct: true, answeredAt: at(9) } })).toThrow('out of order')
  })
})
