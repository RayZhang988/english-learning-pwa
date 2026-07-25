import { describe, expect, it } from 'vitest'
import { parseLearningEvent } from '../../learning-engine/index.ts'
import {
  createSpeakingCompletedEvent,
  createSpeakingTaskStartedEvent,
  createSpeakingUnscorableEvent,
} from './events.ts'
import { matchSpeakingText } from './matching.ts'
import {
  advanceSpeakingSession,
  beginSpeakingRecording,
  createSpeakingSession,
  processSpeakingRecording,
  submitSpeakingRecording,
} from './session.ts'
import {
  createSpeakingTask,
  createSpeakingUnit,
  speakingPrompt,
} from './test-fixtures.ts'

const identity = {
  eventId: 'speaking-event-1',
  occurredAt: '2026-07-24T12:00:05.000Z',
  localDate: '2026-07-24',
}
const recordingCapabilities = {
  supported: true,
  supportedMimeTypes: ['audio/mp4'],
} as const
const recognitionCapabilities = {
  supported: true,
  requiresSiri: true,
} as const

function completedSession() {
  let session = createSpeakingSession(
    createSpeakingTask(),
    createSpeakingUnit(),
    'granted',
    'online',
    recordingCapabilities,
    recognitionCapabilities,
    '2026-07-24T12:00:00.000Z',
  )
  session = beginSpeakingRecording(
    session,
    'granted',
    true,
    '2026-07-24T12:00:01.000Z',
  )
  session = processSpeakingRecording(
    session,
    '2026-07-24T12:00:02.000Z',
  )
  session = submitSpeakingRecording(
    session,
    {
      durationMs: 1_000,
      match: matchSpeakingText(
        'I am from Shanghai',
        speakingPrompt.acceptedAnswers,
      ),
      fallbackReason: null,
      failureCategory: null,
      recognitionErrorCode: null,
      recognitionMessage: null,
    },
    '2026-07-24T12:00:03.000Z',
  )
  return advanceSpeakingSession(
    session,
    recordingCapabilities,
    recognitionCapabilities,
    '2026-07-24T12:00:04.000Z',
  )
}

function completedUnscorableSession() {
  let session = createSpeakingSession(
    createSpeakingTask(),
    createSpeakingUnit(),
    'granted',
    'offline',
    recordingCapabilities,
    recognitionCapabilities,
    '2026-07-24T12:00:00.000Z',
  )
  session = beginSpeakingRecording(
    session,
    'granted',
    false,
    '2026-07-24T12:00:01.000Z',
  )
  session = processSpeakingRecording(
    session,
    '2026-07-24T12:00:02.000Z',
  )
  session = submitSpeakingRecording(
    session,
    {
      durationMs: 1_000,
      match: null,
      fallbackReason: 'recognition-offline',
      failureCategory: 'network',
      recognitionErrorCode: 'network',
      recognitionMessage: '当前离线。',
    },
    '2026-07-24T12:00:03.000Z',
  )
  return advanceSpeakingSession(
    session,
    recordingCapabilities,
    recognitionCapabilities,
    '2026-07-24T12:00:04.000Z',
  )
}

describe('speaking learning events', () => {
  it('publishes valid speaking start and scored attempt envelopes', () => {
    const task = createSpeakingTask()
    const started = createSpeakingTaskStartedEvent(task, identity)
    const completed = createSpeakingCompletedEvent(
      completedSession(),
      4,
      { ...identity, eventId: 'speaking-event-2' },
    )

    expect(parseLearningEvent(started)).toBe(started)
    expect(parseLearningEvent(completed)).toBe(completed)
    expect(completed.payload).toMatchObject({
      result: 'scored',
      performanceScore: 1,
      evidenceQuality: 0.75,
      taskCompleted: true,
      failureCategory: null,
    })
  })

  it('keeps recognition failure unscorable and incomplete', () => {
    const event = createSpeakingUnscorableEvent(
      completedUnscorableSession(),
      3,
      identity,
    )

    expect(parseLearningEvent(event)).toBe(event)
    expect(event.payload).toMatchObject({
      result: 'unscorable',
      performanceScore: null,
      evidenceQuality: 0,
      taskCompleted: false,
      failureCategory: 'network',
    })
  })

  it('refuses to manufacture unscorable completion before the session is complete', () => {
    const active = createSpeakingSession(
      createSpeakingTask(),
      createSpeakingUnit(),
      'granted',
      'offline',
      recordingCapabilities,
      recognitionCapabilities,
      '2026-07-24T12:00:00.000Z',
    )

    expect(() =>
      createSpeakingUnscorableEvent(active, 0, identity),
    ).toThrow(/requires a completed session/i)
  })
})
