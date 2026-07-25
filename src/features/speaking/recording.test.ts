import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserSpeakingRecorder,
  getSpeakingRecordingCapabilities,
  supportedSpeakingMimeTypes,
} from './recording.ts'

class FakeMediaRecorder {
  static isTypeSupported(type: string) {
    return type === 'audio/mp4' || type === 'audio/webm'
  }

  readonly mimeType: string
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: (() => void) | null = null

  constructor(
    _stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.ondataavailable?.({
      data: new Blob(['voice'], { type: this.mimeType }),
    } as BlobEvent)
    this.state = 'inactive'
    this.onstop?.()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('browser speaking recorder', () => {
  it('prefers Safari-compatible MP4 when available', () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    expect(supportedSpeakingMimeTypes()[0]).toBe('audio/mp4')
    expect(getSpeakingRecordingCapabilities()).toEqual({
      supported: true,
      supportedMimeTypes: ['audio/mp4', 'audio/webm'],
    })
  })

  it('records a non-empty blob and stops microphone tracks', async () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const stopTrack = vi.fn()
    const stream = {
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream
    let time = 1_000
    const recorder = new BrowserSpeakingRecorder({
      nowMs: () => time,
      createId: () => 'recording-1',
    })

    recorder.start(stream)
    time = 2_250
    const recording = await recorder.stop()

    expect(recording).toMatchObject({
      id: 'recording-1',
      mimeType: 'audio/mp4',
      durationMs: 1_250,
    })
    expect(recording.blob.size).toBeGreaterThan(0)
    expect(stopTrack).toHaveBeenCalledOnce()
  })

  it('plays a recording locally and revokes its object URL', async () => {
    const revoke = vi.fn()
    let endPlayback: (() => void) | null = null
    const recorder = new BrowserSpeakingRecorder({
      createAudio: () => ({
        onended: null,
        onerror: null,
        currentTime: 0,
        play() {
          queueMicrotask(() => endPlayback?.())
          return Promise.resolve()
        },
        pause() {},
      }),
      createObjectUrl: () => 'blob:recording-1',
      revokeObjectUrl: revoke,
    })
    const playback = recorder.play({
      id: 'recording-1',
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 1_000,
    })
    endPlayback = () => recorder.stopPlayback()

    await playback

    expect(revoke).toHaveBeenCalledWith('blob:recording-1')
  })
})
