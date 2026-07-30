import { describe, expect, it } from 'vitest'
import { parseLearningEvent } from '../../learning-engine/index.ts'
import {
  createListeningCompletedEvent,
  createListeningTaskPausedEvent,
  createListeningTaskStartedEvent,
  createListeningUnscorableEvent,
} from './events.ts'
import {
  advanceListeningSession,
  createListeningSession,
  selectListeningOption,
  submitListeningAnswer,
  updateListeningPlayback,
} from './session.ts'
import {
  choiceQuestion,
  createListeningTask,
  createListeningUnit,
} from './test-fixtures.ts'

const identity = {
  eventId: 'listening:event-1',
  occurredAt: '2026-07-24T12:00:00.000Z',
  localDate: '2026-07-24',
}

describe('listening learning events', () => {
  it('creates parseable start and pause events', () => {
    const task = createListeningTask()
    const started = createListeningTaskStartedEvent(task, identity)
    const paused = createListeningTaskPausedEvent(
      task,
      'app-backgrounded',
      12.9,
      { ...identity, eventId: 'listening:event-2' },
    )
    expect(parseLearningEvent(started).sourceModuleId).toBe('listening')
    const parsedPause = parseLearningEvent(paused)
    expect(parsedPause.type).toBe('learning.task.paused.v1')
    expect(paused.payload.durationSeconds).toBe(12)
  })

  it('reports completed deterministic scoring and assistance', () => {
    let session = createListeningSession(
      createListeningTask(),
      createListeningUnit([choiceQuestion]),
      identity.occurredAt,
    )
    session = updateListeningPlayback(
      session,
      {
        ...session.playback,
        status: 'ended',
        rate: 0.75,
        playCounts: { 'seg-word': 2 },
        completedPlayCounts: { 'seg-word': 2 },
      },
      '2026-07-24T12:00:01.000Z',
    )
    session = selectListeningOption(
      session,
      'a',
      '2026-07-24T12:00:02.000Z',
    )
    session = submitListeningAnswer(
      session,
      '2026-07-24T12:00:03.000Z',
    )
    session = advanceListeningSession(
      session,
      '2026-07-24T12:00:04.000Z',
    )
    const event = createListeningCompletedEvent(
      session,
      4,
      identity,
    )
    expect(parseLearningEvent(event).payload).toMatchObject({
      result: 'scored',
      performanceScore: 1,
      assistanceLevel: 0.35,
      taskCompleted: true,
      failureCategory: null,
    })
  })

  it('keeps device and content failures unscorable', () => {
    const event = createListeningUnscorableEvent(
      createListeningTask(),
      'device',
      10,
      identity,
    )
    expect(parseLearningEvent(event).payload).toMatchObject({
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      taskCompleted: false,
      failureCategory: 'device',
    })
  })
})
