import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserSpeakingRecorder,
  getSpeakingRecordingCapabilities,
  supportedSpeakingMimeTypes,
} from './recording.ts'

class FakeMediaRecorder {
  static latest: FakeMediaRecorder | null = null

  static isTypeSupported(type: string) {
    return type === 'audio/mp4' || type === 'audio/webm'
  }

  readonly mimeType: string
  state: RecordingState = 'inactive'
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: (() => void) | null = null
  onstart: (() => void) | null = null
  onpause: (() => void) | null = null
  onresume: (() => void) | null = null

  constructor(
    _stream: MediaStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
    FakeMediaRecorder.latest = this
  }

  start() {
    this.state = 'recording'
    this.onstart?.()
  }

  pause() {
    this.state = 'paused'
    this.onpause?.()
  }

  resume() {
    this.state = 'recording'
    this.onresume?.()
  }

  stop() {
    this.ondataavailable?.({
      data: new Blob(['voice'], { type: this.mimeType }),
    } as BlobEvent)
    this.state = 'inactive'
    this.onstop?.()
  }

  fail() {
    this.onerror?.({
      error: new DOMException('device failure', 'UnknownError'),
    } as unknown as Event)
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

  it('reports actual MediaRecorder start, pause, resume, stop and error callbacks', async () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const stream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream
    const events: string[] = []
    const recorder = new BrowserSpeakingRecorder({
      createId: () => 'recording-events',
    })

    recorder.start(stream, {
      onStarted: () => events.push('started'),
      onPaused: () => events.push('paused'),
      onResumed: () => events.push('resumed'),
      onStopped: () => events.push('stopped'),
      onError: () => events.push('error'),
    })
    FakeMediaRecorder.latest?.pause()
    FakeMediaRecorder.latest?.resume()
    await recorder.stop()

    expect(events).toEqual([
      'started',
      'paused',
      'resumed',
      'stopped',
    ])

    recorder.start(stream, {
      onStarted: () => events.push('started-again'),
      onPaused: () => undefined,
      onResumed: () => undefined,
      onStopped: () => undefined,
      onError: () => events.push('error'),
    })
    FakeMediaRecorder.latest?.fail()
    expect(events.at(-1)).toBe('error')
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

  it('reports actual playback start, waiting, pause, end and error callbacks', async () => {
    let audio:
      | {
          onended: ((event: Event) => void) | null
          onerror: ((event: Event) => void) | null
          onpause: ((event: Event) => void) | null
          onplaying: ((event: Event) => void) | null
          onwaiting: ((event: Event) => void) | null
          onseeking: ((event: Event) => void) | null
          currentTime: number
          play(): Promise<void>
          pause(): void
        }
      | undefined
    const events: string[] = []
    const recorder = new BrowserSpeakingRecorder({
      createAudio: () => {
        audio = {
          onended: null,
          onerror: null,
          onpause: null,
          onplaying: null,
          onwaiting: null,
          onseeking: null,
          currentTime: 0,
          async play() {},
          pause() {},
        }
        return audio
      },
      createObjectUrl: () => 'blob:recording-events',
      revokeObjectUrl: () => undefined,
    })
    const recording = {
      id: 'recording-events',
      blob: new Blob(['voice'], { type: 'audio/mp4' }),
      mimeType: 'audio/mp4',
      durationMs: 1_000,
    }
    const playback = recorder.play(recording, {
      onStarted: () => events.push('started'),
      onPaused: () => events.push('paused'),
      onWaiting: () => events.push('waiting'),
      onEnded: () => events.push('ended'),
      onError: () => events.push('error'),
    })

    audio?.onplaying?.(new Event('playing'))
    audio?.onwaiting?.(new Event('waiting'))
    audio?.onseeking?.(new Event('seeking'))
    audio?.onpause?.(new Event('pause'))
    audio?.onplaying?.(new Event('playing'))
    audio?.onended?.(new Event('ended'))
    await playback

    expect(events).toEqual([
      'started',
      'waiting',
      'waiting',
      'paused',
      'started',
      'ended',
    ])
  })
})
