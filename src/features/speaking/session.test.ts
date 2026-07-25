import { describe, expect, it } from 'vitest'
import { matchSpeakingText } from './matching.ts'
import {
  advanceSpeakingSession,
  beginSpeakingRecording,
  createSpeakingSession,
  getSpeakingSessionResult,
  markSpeakingCaptureUnavailable,
  processSpeakingRecording,
  submitSpeakingRecording,
  submitSpeakingWithoutRecording,
} from './session.ts'
import {
  createSpeakingTask,
  createSpeakingUnit,
  speakingPrompt,
} from './test-fixtures.ts'

const now = '2026-07-24T12:00:00.000Z'
const recordingCapabilities = {
  supported: true,
  supportedMimeTypes: ['audio/mp4'],
} as const
const recognitionCapabilities = {
  supported: true,
  requiresSiri: true,
} as const

function sessionWithTwoPrompts() {
  return createSpeakingSession(
    createSpeakingTask(),
    createSpeakingUnit([
      speakingPrompt,
      {
        ...speakingPrompt,
        id: 'w1d1-s2',
        cueZh: '说明你在纽约旅行。',
        modelAnswer: "I'm visiting New York.",
        acceptedAnswers: ["I'm visiting New York."],
      },
    ]),
    'granted',
    'online',
    recordingCapabilities,
    recognitionCapabilities,
    now,
  )
}

describe('speaking session state machine', () => {
  it('records recognized text and advances only after review', () => {
    let session = sessionWithTwoPrompts()
    session = beginSpeakingRecording(
      session,
      'granted',
      true,
      '2026-07-24T12:00:01.000Z',
    )
    session = processSpeakingRecording(
      session,
      '2026-07-24T12:00:03.000Z',
    )
    session = submitSpeakingRecording(
      session,
      {
        durationMs: 2_000,
        match: matchSpeakingText(
          'I am from Shanghai',
          speakingPrompt.acceptedAnswers,
        ),
        fallbackReason: null,
        failureCategory: null,
        recognitionErrorCode: null,
        recognitionMessage: null,
      },
      '2026-07-24T12:00:04.000Z',
    )

    expect(session.phase).toBe('feedback')
    expect(session.recorder.playbackAvailable).toBe(true)
    expect(session.answers[0].match?.level).toBe('match')

    session = advanceSpeakingSession(
      session,
      recordingCapabilities,
      recognitionCapabilities,
      '2026-07-24T12:00:05.000Z',
    )
    expect(session.phase).toBe('practicing')
    expect(session.promptIndex).toBe(1)
  })

  it('allows offline recognition fallback through recording review', () => {
    let session = createSpeakingSession(
      createSpeakingTask(),
      createSpeakingUnit(),
      'granted',
      'offline',
      recordingCapabilities,
      recognitionCapabilities,
      now,
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
        recognitionMessage: '当前离线；请回放录音自查。',
      },
      '2026-07-24T12:00:03.000Z',
    )

    expect(session.phase).toBe('feedback')
    expect(session.recorder.playbackAvailable).toBe(true)
    expect(getSpeakingSessionResult(session)).toMatchObject({
      recognizedCount: 0,
      unscorableCount: 1,
      performanceScore: null,
      failureCategory: 'network',
    })
  })

  it('cannot fake recording playback after permission denial', () => {
    let session = createSpeakingSession(
      createSpeakingTask(),
      createSpeakingUnit(),
      'denied',
      'online',
      recordingCapabilities,
      recognitionCapabilities,
      now,
    )
    session = markSpeakingCaptureUnavailable(
      session,
      'denied',
      'permission-denied',
      '麦克风权限被拒绝。',
      '2026-07-24T12:00:01.000Z',
    )
    session = submitSpeakingWithoutRecording(
      session,
      'permission-denied',
      'permission',
      '2026-07-24T12:00:02.000Z',
    )

    expect(session.phase).toBe('feedback')
    expect(session.recorder.playbackAvailable).toBe(false)
    expect(session.answers[0]).toMatchObject({
      recorded: false,
      transcript: null,
      failureCategory: 'permission',
    })
  })
})
