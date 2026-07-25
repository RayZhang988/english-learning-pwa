import { describe, expect, it } from 'vitest'
import type { PlatformEvent } from '../core/index.ts'
import { parseLearningEvent } from './events.ts'
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
})
