import { describe, expect, it } from 'vitest'
import { applyLearningAttempt, createLearningEngineState } from './engine.ts'
import {
  buildProgressSnapshot,
  getReassessmentRecommendation,
  recordDailyActivity,
} from './progress.ts'
import { abilityProfile, attemptEvent } from './test-fixtures.ts'

describe('progress metrics', () => {
  it('calculates an improving trend and repeated common errors', () => {
    let state = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const scores = [0.3, 0.35, 0.4, 0.35, 0.85, 0.9, 0.95, 0.9]
    scores.forEach((performanceScore, index) => {
      const day = String(index + 2).padStart(2, '0')
      state = applyLearningAttempt(
        state,
        attemptEvent({
          id: `event-${index}`,
          taskId: `task-${index}`,
          learningUnitId: `vocabulary-${index}`,
          contentRef: `lesson://vocabulary/${index}`,
          localDate: `2026-07-${day}`,
          occurredAt: `2026-07-${day}T00:00:00.000Z`,
          performanceScore,
          errorTags:
            index < 4 ? ['meaning-recall'] : [],
        }),
      ).state
    })

    const snapshot = buildProgressSnapshot(
      state.progress,
      '2026-07-10T00:00:00.000Z',
      '2026-07-10',
    )
    expect(snapshot.domains.vocabulary.trend).toBe('improving')
    expect(snapshot.domains.vocabulary.commonErrors[0]).toMatchObject({
      tag: 'meaning-recall',
      recentCount: 4,
    })
    expect(snapshot.domains.vocabulary.levelChange).not.toBe(0)
  })

  it('tracks streaks and recommends a reassessment after 14 qualifying days', () => {
    let progress = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    ).progress
    for (let day = 1; day <= 14; day += 1) {
      const localDate = `2026-07-${String(day).padStart(2, '0')}`
      progress = recordDailyActivity(progress, {
        localDate,
        plannedSeconds: 2700,
        effectiveSeconds: 600,
        completedTaskCount: 2,
        planCompleted: day % 2 === 0,
        recordedAt: `${localDate}T12:00:00.000Z`,
      })
    }

    const snapshot = buildProgressSnapshot(
      progress,
      '2026-07-14T12:00:00.000Z',
      '2026-07-14',
    )
    expect(snapshot.streak.currentDays).toBe(14)
    expect(snapshot.streak.longestDays).toBe(14)
    expect(getReassessmentRecommendation(progress)).toMatchObject({
      due: true,
      reason: 'fourteen-learning-days',
      qualifyingDaysSinceLastAssessment: 14,
    })
  })

  it('uses a proportional threshold for a genuinely short plan', () => {
    let progress = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    ).progress
    progress = recordDailyActivity(progress, {
      localDate: '2026-07-02',
      plannedSeconds: 600,
      effectiveSeconds: 300,
      completedTaskCount: 1,
      planCompleted: false,
      recordedAt: '2026-07-02T12:00:00.000Z',
    })

    expect(progress.dailyActivity[0].qualifiesForStreak).toBe(true)
  })
})
