import { describe, expect, it } from 'vitest'
import type {
  SpeakingRecording,
  SpeakingRecordingPort,
} from '../../features/speaking/index.ts'
import type {
  AssessmentRecognitionOutcome,
  AssessmentSpeechRecognitionPort,
  MicrophonePermissionService,
} from '../../platform/index.ts'
import { AssessmentCaptureController } from './assessment-capture-controller.ts'

class FakeRecorder implements SpeakingRecordingPort {
  recording = false
  played = 0
  discarded = 0

  capabilities() {
    return {
      supported: true,
      supportedMimeTypes: ['audio/mp4'],
    }
  }

  start(_stream: MediaStream) {
    this.recording = true
  }

  async stop(): Promise<SpeakingRecording> {
    this.recording = false
    return {
      id: 'recording-1',
      blob: new Blob(['audio'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 3_200,
    }
  }

  cancel() {
    this.recording = false
  }

  async play(_recording: SpeakingRecording) {
    this.played += 1
  }

  stopPlayback() {}

  discard(_recording: SpeakingRecording) {
    this.discarded += 1
  }

  dispose() {}
}

function microphone(
  permission: 'granted' | 'denied' = 'granted',
): MicrophonePermissionService {
  return {
    query: async () => permission,
    request: async () => ({}) as MediaStream,
  }
}

function recognition(
  outcome: AssessmentRecognitionOutcome,
): AssessmentSpeechRecognitionPort {
  return {
    supported: () => true,
    start: () => ({
      result: Promise.resolve(outcome),
      stop() {},
      abort() {},
    }),
  }
}

describe('AssessmentCaptureController', () => {
  it('keeps recognized transcript, real confidence, duration and playback', async () => {
    const recorder = new FakeRecorder()
    const controller = new AssessmentCaptureController({
      microphone: microphone(),
      recorder,
      recognition: recognition({
        status: 'recognized',
        transcript: 'I need a quiet room',
        confidence: 0.82,
      }),
    })

    await expect(controller.initialize()).resolves.toMatchObject({
      status: 'ready',
    })
    await expect(controller.begin()).resolves.toMatchObject({
      status: 'recording',
    })
    await expect(controller.finish()).resolves.toEqual({
      status: 'review',
      result: {
        recognition: {
          status: 'recognized',
          transcript: 'I need a quiet room',
          confidence: 0.82,
        },
        durationMs: 3_200,
        recordingAvailable: true,
        failure: null,
      },
      playbackAvailable: true,
    })

    await controller.play()
    expect(recorder.played).toBe(1)
  })

  it('maps offline recognition failure to unscorable playback fallback', async () => {
    const controller = new AssessmentCaptureController({
      microphone: microphone(),
      recorder: new FakeRecorder(),
      recognition: recognition({
        status: 'failed',
        code: 'network',
      }),
      isOnline: () => false,
    })

    await controller.initialize()
    await controller.begin()
    await expect(controller.finish()).resolves.toEqual({
      status: 'review',
      result: {
        recognition: {
          status: 'failed',
          code: 'network',
        },
        durationMs: 3_200,
        recordingAvailable: true,
        failure: {
          status: 'unscorable',
          reason: 'offline',
          recordingAvailable: true,
        },
      },
      playbackAvailable: true,
    })
  })

  it('never fabricates a recording after permission denial', async () => {
    const controller = new AssessmentCaptureController({
      microphone: microphone('denied'),
      recorder: new FakeRecorder(),
      recognition: recognition({
        status: 'failed',
        code: 'not-allowed',
      }),
    })

    await expect(controller.initialize()).resolves.toEqual({
      status: 'unavailable',
      result: {
        recognition: {
          status: 'failed',
          code: 'not-allowed',
        },
        durationMs: 0,
        recordingAvailable: false,
        failure: {
          status: 'unscorable',
          reason: 'permission-denied',
          recordingAvailable: false,
        },
      },
      playbackAvailable: false,
    })
  })
})
