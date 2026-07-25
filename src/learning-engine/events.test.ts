import { describe, expect, it } from 'vitest'
import type { PlatformEvent } from '../core/index.ts'
import { parseLearningEvent } from './events.ts'
import { resolveAttemptPlanDisposition } from './lifecycle.ts'
import { attemptEvent } from './test-fixtures.ts'

describe('learning event contract', () => {
  it('accepts a valid standardized attempt event', () => {
    const event = attemptEvent()
    expect(parseLearningEvent(event)).toEqual(event)
  })

  it('rejects a source module that does not match the task domain', () => {
    const event = {
      ...attemptEvent(),
      sourceModuleId: 'listening',
    } as PlatformEvent
    expect(() => parseLearningEvent(event)).toThrow(
      'domain, targetModuleId, and sourceModuleId must match',
    )
  })

  it('rejects an unscorable attempt that claims task completion', () => {
    const event = attemptEvent({
      result: 'unscorable',
      performanceScore: null,
      taskCompleted: true,
      failureCategory: 'device',
    })
    expect(() => parseLearningEvent(event)).toThrow(
      'unscorable attempt cannot complete a task',
    )
  })

  it('parses the existing speaking v1 fallback event without new fields', () => {
    const event = attemptEvent({
      domain: 'speaking',
      targetModuleId: 'speaking',
      learningUnitId: 'speaking-1',
      contentRef: 'lesson://speaking/1',
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      taskCompleted: false,
      failureCategory: 'network',
    })
    const parsed = parseLearningEvent(event)

    expect(parsed).toEqual(event)
    expect(
      resolveAttemptPlanDisposition(
        parsed as Extract<
          typeof parsed,
          { type: 'learning.attempt.completed.v1' }
        >,
      ),
    ).toBe('unscorable-practice-completion')
  })
})
