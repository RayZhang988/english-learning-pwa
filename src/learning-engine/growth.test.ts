import { describe, expect, it } from 'vitest'
import {
  applyGrowthTrainingCompleted,
  createGrowthState,
  getGrowthEligibility,
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
})
