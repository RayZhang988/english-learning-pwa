import { describe, expect, it } from 'vitest'
import { matchSpeakingText } from './matching.ts'
import {
  beginSpeakingRecording,
  createSpeakingSession,
  markSpeakingCaptureUnavailable,
  pauseSpeakingSession,
  processSpeakingRecording,
  submitSpeakingRecording,
} from './session.ts'
import {
  createSpeakingTask,
  createSpeakingUnit,
  speakingPrompt,
} from './test-fixtures.ts'
import { toSpeakingScreenViewModel } from './view-model.ts'

const recordingCapabilities = {
  supported: true,
  supportedMimeTypes: ['audio/mp4'],
} as const
const recognitionCapabilities = {
  supported: true,
  requiresSiri: true,
} as const

function baseSession() {
  return createSpeakingSession(
    createSpeakingTask(),
    createSpeakingUnit(),
    'granted',
    'online',
    recordingCapabilities,
    recognitionCapabilities,
    '2026-07-24T12:00:00.000Z',
  )
}

describe('speaking screen ViewModel', () => {
  it('exposes course prompts and keeps scoring claims limited to text', () => {
    let session = beginSpeakingRecording(
      baseSession(),
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

    const viewModel = toSpeakingScreenViewModel(session)

    expect(viewModel.partnerLine).toBe('Where are you from?')
    expect(viewModel.modelAnswer).toBe("I'm from Shanghai.")
    expect(viewModel.feedback?.title).toContain('目标表达')
    expect(viewModel.feedback?.description).toContain('不是发音评分')
    expect(viewModel.contentMatch).toEqual({
      state: 'recognized',
      targetText: "I'm from Shanghai.",
      targetTranslationZh: '我来自上海。',
      recognizedText: 'I am from Shanghai',
      level: 'match',
      resultLabel: '内容一致',
      guidance: '识别文本包含完整目标表达，可以继续。',
    })
    expect(viewModel.recorder.playbackAvailable).toBe(true)
    expect(viewModel.secondaryActionLabel).toBe('播放示范原句')
  })

  it('separates a partial transcript from the target without claiming pronunciation scoring', () => {
    let session = beginSpeakingRecording(
      baseSession(),
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
          'I am Shanghai',
          speakingPrompt.acceptedAnswers,
        ),
        fallbackReason: null,
        failureCategory: null,
        recognitionErrorCode: null,
        recognitionMessage: null,
      },
      '2026-07-24T12:00:03.000Z',
    )

    expect(toSpeakingScreenViewModel(session).contentMatch).toEqual({
      state: 'recognized',
      targetText: "I'm from Shanghai.",
      targetTranslationZh: '我来自上海。',
      recognizedText: 'I am Shanghai',
      level: 'partial',
      resultLabel: '只匹配到部分内容',
      guidance: '只识别到部分目标内容，建议对照目标表达再说一次。',
    })
  })

  it('shows the target but no invented transcript when recognition fails', () => {
    let session = beginSpeakingRecording(
      baseSession(),
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
        match: null,
        fallbackReason: 'recognition-no-speech',
        failureCategory: 'device',
        recognitionErrorCode: 'no-speech',
        recognitionMessage: '没有识别到文本。',
      },
      '2026-07-24T12:00:03.000Z',
    )

    expect(toSpeakingScreenViewModel(session).contentMatch).toEqual({
      state: 'unscorable',
      targetText: "I'm from Shanghai.",
      targetTranslationZh: '我来自上海。',
      recognizedText: null,
      resultLabel: '本次无法判断内容是否说对',
      guidance: '录音已经保留，请回放并对照目标表达自查。',
    })
    expect(toSpeakingScreenViewModel(session).secondaryActionLabel).toBe('播放示范原句')
  })

  it('maps permission failure to device feedback and unscored continuation', () => {
    const denied = markSpeakingCaptureUnavailable(
      baseSession(),
      'denied',
      'permission-denied',
      '麦克风权限被拒绝。',
      '2026-07-24T12:00:01.000Z',
    )

    const viewModel = toSpeakingScreenViewModel(denied)

    expect(viewModel.recorder.status).toBe('unavailable')
    expect(viewModel.feedback?.tone).toBe('device')
    expect(viewModel.action).toEqual({
      label: '继续（本题不评分）',
    })
  })

  it('disables recorder interaction while the task is paused', () => {
    const paused = pauseSpeakingSession(
      baseSession(),
      '2026-07-24T12:00:01.000Z',
    )

    const viewModel = toSpeakingScreenViewModel(paused)

    expect(viewModel.recorder.status).toBe('processing')
    expect(viewModel.recorder.statusLabel).toBe('训练已暂停')
    expect(viewModel.action.label).toBe('继续训练')
  })
})
