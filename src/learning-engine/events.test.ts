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

  it('accepts a serializable stream item event and rejects malformed cursors', () => {
    const base = attemptEvent()
    const event = {
      ...base,
      id: 'stream-item-1',
      type: 'learning.training.item.completed.v1',
      payload: {
        ...base.payload,
        requestId: 'task-1:supply:1:initial',
        nextSupplyCursor: 'cursor-2',
        outcome: 'scored',
        item: {
          itemId: 'item-1',
          learningUnitId: 'vocabulary-1',
          contentRef: 'lesson://vocabulary/1',
          difficultyLevel: 4,
          tags: ['travel'],
        },
      },
    } as PlatformEvent
    expect(parseLearningEvent(event)).toEqual(event)
    expect(() =>
      parseLearningEvent({
        ...event,
        payload: {
          ...(event.payload as Record<string, unknown>),
          nextSupplyCursor: 1,
        },
      }),
    ).toThrow('nextSupplyCursor')
  })

  it('accepts a content recovery event only with its exhausted request identity', () => {
    const base = attemptEvent()
    const event = {
      ...base,
      id: 'content-recovered-1',
      type: 'learning.training.content.recovered.v1',
      payload: {
        ...base.payload,
        exhaustionRequestId: 'task-1:supply:2:cursor-2',
      },
    } as PlatformEvent
    expect(parseLearningEvent(event)).toEqual(event)
    expect(() =>
      parseLearningEvent({
        ...event,
        payload: {
          ...(event.payload as Record<string, unknown>),
          exhaustionRequestId: '',
        },
      }),
    ).toThrow('exhaustionRequestId')
  })
})
