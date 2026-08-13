import { describe, expect, it, vi } from 'vitest'
import type { ListeningSpeechPort } from '../listening/index.ts'
import type { SpeakingGrowthUpgradeAdapter } from './growth-upgrade.ts'
import type { SpeakingRecognitionPort, SpeakingRecording, SpeakingRecordingPort } from './types.ts'
import { SpeakingGrowthUpgradeMediaSession } from './growth-upgrade-media.ts'

const recording: SpeakingRecording = { id: 'recording-1', blob: new Blob(['sound']), mimeType: 'audio/webm', durationMs: 900 }

function setup() {
  const recorder: SpeakingRecordingPort = {
    capabilities: () => ({ supported: true, supportedMimeTypes: ['audio/webm'] }),
    start: vi.fn(), stop: vi.fn(async () => recording), cancel: vi.fn(),
    play: vi.fn(async () => undefined), stopPlayback: vi.fn(), discard: vi.fn(), dispose: vi.fn(),
  }
  const recognition: SpeakingRecognitionPort = {
    capabilities: () => ({ supported: true, requiresSiri: false }),
    start: vi.fn(() => ({ result: Promise.resolve({ status: 'recognized' as const, transcript: 'Hello there', alternatives: [] }), stop: vi.fn(), abort: vi.fn() })),
  }
  const adapter: SpeakingGrowthUpgradeAdapter = {
    resolve: vi.fn(async ({ itemId, recordingExists }) => ({ itemId, kind: 'fixed-response' as const, partnerLine: 'Hello', cueZh: '回答', referenceText: recordingExists ? 'Hello there' : null, recording: { allowReferencePlaybackAfterRecording: true as const } })),
    submit: vi.fn(async ({ itemId, recording: saved }) => ({ itemId, scorable: true as const, correct: true, retryable: false as const, recording: saved, contentMatch: { state: 'recognized' as const, match: { level: 'match' as const, similarity: 1, transcript: 'Hello there', normalizedTranscript: 'hello there', closestAcceptedAnswer: 'Hello there', normalizedAcceptedAnswer: 'hello there' }, targetText: 'Hello there', targetTranslationZh: '你好' } })),
  }
  const speech: ListeningSpeechPort = { capabilities: () => ({ supported: true, voicesKnown: true, enUsVoiceAvailable: true, localEnUsVoiceCount: 1, pauseResumeAvailable: true, supportedRates: [1] }), voices: () => [], speak: vi.fn((_, callbacks) => callbacks.onEnd?.()), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), isPaused: () => false, isSpeaking: () => false }
  const media = new SpeakingGrowthUpgradeMediaSession({ adapter, itemId: 'growth-speaking-1', expectedDifficultyLevel: 0.5, recorder, recognition, speech, requestMicrophone: async () => ({ getTracks: () => [] }) as unknown as MediaStream })
  return { media, recorder, recognition, adapter, speech }
}

describe('SpeakingGrowthUpgradeMediaSession', () => {
  it('records, recognizes, exposes reference playback only after recording, and returns the adapter result', async () => {
    const { media, recorder, adapter, speech } = setup()
    await media.initialize()
    expect(media.current().referenceText).toBeNull()
    await media.startRecording()
    expect(media.current().status).toBe('capturing')
    const result = await media.stopRecording()
    expect(result?.scorable).toBe(true)
    expect(media.current()).toMatchObject({ status: 'feedback', recordingAvailable: true, referenceText: 'Hello there' })
    await media.playRecording()
    await media.playReference()
    expect(recorder.play).toHaveBeenCalledWith(recording, expect.anything())
    expect(speech.speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello there', locale: 'en-US', usePreferredDeviceVoice: true }), expect.anything())
    expect(adapter.submit).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed recognition replayable and retryable without scoring it', async () => {
    const { media, recognition, adapter, recorder } = setup()
    ;(recognition.start as ReturnType<typeof vi.fn>).mockReturnValue({ result: Promise.resolve({ status: 'failed', code: 'no-speech', message: 'No speech' }), stop: vi.fn(), abort: vi.fn() })
    await media.initialize(); await media.startRecording()
    const result = await media.stopRecording()
    expect(result).toBeNull()
    expect(media.current()).toMatchObject({ status: 'unscorable', recordingAvailable: true, retryable: true })
    await media.playRecording()
    await media.recordAgain()
    expect(recorder.discard).toHaveBeenCalledWith(recording)
    expect(adapter.submit).not.toHaveBeenCalled()
  })
})
