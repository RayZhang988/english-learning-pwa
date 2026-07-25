import { SpeakingError } from './errors.ts'
import type {
  SpeakingRecording,
  SpeakingRecordingCapabilities,
  SpeakingRecordingPort,
} from './types.ts'

const preferredMimeTypes = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

interface PlaybackAudio {
  onended: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  currentTime: number
  play(): Promise<void>
  pause(): void
}

interface BrowserSpeakingRecorderOptions {
  readonly nowMs?: () => number
  readonly createId?: () => string
  readonly createAudio?: (url: string) => PlaybackAudio
  readonly createObjectUrl?: (blob: Blob) => string
  readonly revokeObjectUrl?: (url: string) => void
}

export function supportedSpeakingMimeTypes(): readonly string[] {
  if (typeof MediaRecorder === 'undefined') {
    return []
  }
  return preferredMimeTypes.filter((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  )
}

export function getSpeakingRecordingCapabilities():
  SpeakingRecordingCapabilities {
  const supportedMimeTypes = supportedSpeakingMimeTypes()
  return {
    supported: typeof MediaRecorder !== 'undefined',
    supportedMimeTypes,
  }
}

export class BrowserSpeakingRecorder
  implements SpeakingRecordingPort
{
  private readonly nowMs: () => number
  private readonly createId: () => string
  private readonly createAudio: (url: string) => PlaybackAudio
  private readonly createObjectUrl: (blob: Blob) => string
  private readonly revokeObjectUrl: (url: string) => void
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private activeAudio: PlaybackAudio | null = null
  private activeAudioUrl: string | null = null
  private finishPlayback: ((error?: Error) => void) | null = null

  constructor(options: BrowserSpeakingRecorderOptions = {}) {
    this.nowMs = options.nowMs ?? (() => performance.now())
    this.createId =
      options.createId ?? (() => globalThis.crypto.randomUUID())
    this.createAudio =
      options.createAudio ??
      ((url) => new Audio(url))
    this.createObjectUrl =
      options.createObjectUrl ??
      ((blob) => URL.createObjectURL(blob))
    this.revokeObjectUrl =
      options.revokeObjectUrl ??
      ((url) => URL.revokeObjectURL(url))
  }

  capabilities(): SpeakingRecordingCapabilities {
    return getSpeakingRecordingCapabilities()
  }

  start(stream: MediaStream): void {
    if (this.recorder) {
      throw new SpeakingError(
        'session-transition-invalid',
        'A speaking recording is already active.',
      )
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new SpeakingError(
        'recording-unavailable',
        'MediaRecorder is unavailable in this browser.',
      )
    }
    const mimeType = supportedSpeakingMimeTypes()[0]
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
    } catch (error) {
      this.stopTracks(stream)
      throw new SpeakingError(
        'recording-unavailable',
        'The browser could not create an audio recorder.',
        { cause: error },
      )
    }
    this.stream = stream
    this.recorder = recorder
    this.chunks = []
    this.startedAt = this.nowMs()
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data)
      }
    }
    try {
      recorder.start()
    } catch (error) {
      this.clearRecorder()
      throw new SpeakingError(
        'recording-failed',
        'The browser failed to start audio recording.',
        { cause: error },
      )
    }
  }

  stop(): Promise<SpeakingRecording> {
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(
        new SpeakingError(
          'session-transition-invalid',
          'No active speaking recording can be stopped.',
        ),
      )
    }
    return new Promise<SpeakingRecording>((resolve, reject) => {
      const startedAt = this.startedAt
      recorder.onerror = (event) => {
        this.clearRecorder()
        reject(
          new SpeakingError(
            'recording-failed',
            'The browser reported an audio recording failure.',
            { cause: event.error },
          ),
        )
      }
      recorder.onstop = () => {
        const mimeType =
          recorder.mimeType ||
          this.chunks.find((chunk) => chunk.type.length > 0)?.type ||
          'audio/mp4'
        const blob = new Blob(this.chunks, { type: mimeType })
        const durationMs = Math.max(
          0,
          Math.round(this.nowMs() - startedAt),
        )
        this.clearRecorder()
        if (blob.size === 0) {
          reject(
            new SpeakingError(
              'recording-failed',
              'The browser returned an empty audio recording.',
            ),
          )
          return
        }
        resolve({
          id: this.createId(),
          blob,
          mimeType,
          durationMs,
        })
      }
      try {
        recorder.stop()
      } catch (error) {
        this.clearRecorder()
        reject(
          new SpeakingError(
            'recording-failed',
            'The browser failed to stop audio recording.',
            { cause: error },
          ),
        )
      }
    })
  }

  cancel(): void {
    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      try {
        recorder.stop()
      } catch {
        // The capture is already unusable; tracks are still stopped below.
      }
    }
    this.clearRecorder()
  }

  play(recording: SpeakingRecording): Promise<void> {
    this.stopPlayback()
    const url = this.createObjectUrl(recording.blob)
    const audio = this.createAudio(url)
    this.activeAudio = audio
    this.activeAudioUrl = url
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        this.releaseAudio()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }
      this.finishPlayback = finish
      audio.onended = () => finish()
      audio.onerror = () =>
        finish(
          new SpeakingError(
            'playback-failed',
            'The browser could not play the recorded audio.',
          ),
        )
      void audio.play().catch((error: unknown) =>
        finish(
          new SpeakingError(
            'playback-failed',
            'The browser blocked or failed recorded audio playback.',
            {
              cause:
                error instanceof Error
                  ? error
                  : new Error(String(error)),
            },
          ),
        ),
      )
    })
  }

  stopPlayback(): void {
    const finish = this.finishPlayback
    if (this.activeAudio) {
      this.activeAudio.pause()
      this.activeAudio.currentTime = 0
    }
    if (finish) {
      finish()
    } else {
      this.releaseAudio()
    }
  }

  discard(_recording: SpeakingRecording): void {
    // The recording only owns a Blob. Releasing caller references is enough.
  }

  dispose(): void {
    this.cancel()
    this.stopPlayback()
  }

  private stopTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.stop()
    }
  }

  private clearRecorder(): void {
    if (this.stream) {
      this.stopTracks(this.stream)
    }
    this.recorder = null
    this.stream = null
    this.chunks = []
    this.startedAt = 0
  }

  private releaseAudio(): void {
    if (this.activeAudio) {
      this.activeAudio.onended = null
      this.activeAudio.onerror = null
    }
    if (this.activeAudioUrl) {
      this.revokeObjectUrl(this.activeAudioUrl)
    }
    this.activeAudio = null
    this.activeAudioUrl = null
    this.finishPlayback = null
  }
}

export const browserSpeakingRecorder =
  new BrowserSpeakingRecorder()
