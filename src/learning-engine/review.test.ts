import { describe, expect, it } from 'vitest'
import { applyLearningAttempt, createLearningEngineState } from './engine.ts'
import { isRetryDue } from './review.ts'
import { abilityProfile, attemptEvent } from './test-fixtures.ts'

describe('review engine', () => {
  it('does not change mastery for unscorable device failures', () => {
    const state = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const result = applyLearningAttempt(
      state,
      attemptEvent({
        result: 'unscorable',
        performanceScore: null,
        taskCompleted: false,
        failureCategory: 'device',
      }),
    )

    expect(result.evidenceAccepted).toBe(false)
    expect(result.state).toBe(state)
    expect(result.reviewItem).toBeNull()
  })

  it('ignores a duplicate event id instead of learning twice', () => {
    const initial = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const event = attemptEvent()
    const first = applyLearningAttempt(initial, event)
    const duplicate = applyLearningAttempt(first.state, event)

    expect(duplicate.reason).toBe('duplicate')
    expect(duplicate.state).toBe(first.state)
    expect(duplicate.state.progress.attempts).toHaveLength(1)
  })

  it('expands successful intervals and schedules a quick retry after failure', () => {
    const initial = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const first = applyLearningAttempt(initial, attemptEvent())
    const firstItem = first.reviewItem
    expect(firstItem).not.toBeNull()
    expect(firstItem?.successfulReviews).toBe(1)
    expect(firstItem?.retryAt).toBeNull()

    const second = applyLearningAttempt(
      first.state,
      attemptEvent({
        id: 'event-2',
        taskId: 'task-2',
        mode: 'review',
        occurredAt: '2026-07-04T00:00:00.000Z',
        localDate: '2026-07-04',
        performanceScore: 0.95,
      }),
    )
    expect(second.reviewItem?.stabilityDays).toBeGreaterThan(
      firstItem?.stabilityDays ?? 0,
    )

    const failed = applyLearningAttempt(
      second.state,
      attemptEvent({
        id: 'event-3',
        taskId: 'task-3',
        mode: 'review',
        occurredAt: '2026-07-07T00:00:00.000Z',
        localDate: '2026-07-07',
        performanceScore: 0.2,
        errorTags: ['meaning-recall'],
      }),
    )
    expect(failed.reviewItem?.lapseCount).toBe(1)
    expect(failed.reviewItem?.retryAt).toBe('2026-07-07T00:10:00.000Z')
    expect(
      isRetryDue(
        failed.reviewItem!,
        '2026-07-07T00:10:00.000Z',
      ),
    ).toBe(true)
  })

  it('keeps the next interval at one day after a successful same-day retry', () => {
    const initial = createLearningEngineState(
      abilityProfile(),
      '2026-07-01T00:00:00.000Z',
    )
    const failed = applyLearningAttempt(
      initial,
      attemptEvent({ performanceScore: 0.1 }),
    )
    const retried = applyLearningAttempt(
      failed.state,
      attemptEvent({
        id: 'event-2',
        taskId: 'task-2',
        mode: 'retry',
        occurredAt: '2026-07-02T00:15:00.000Z',
        performanceScore: 1,
      }),
    )

    expect(retried.reviewItem?.retryAt).toBeNull()
    expect(retried.reviewItem?.nextReviewAt).toBe(
      '2026-07-03T00:15:00.000Z',
    )
  })
})
