import type { FailedSpeechObservation } from '../../features/assessment/index.ts'
import {
  browserSpeakingRecorder,
  type SpeakingRecording,
  type SpeakingRecordingPort,
} from '../../features/speaking/index.ts'
import {
  browserAssessmentSpeechRecognition,
  browserMicrophonePermission,
  type AssessmentRecognitionFailureCode,
  type AssessmentRecognitionHandle,
  type AssessmentRecognitionOutcome,
  type AssessmentSpeechRecognitionPort,
  type MicrophonePermissionService,
} from '../../platform/index.ts'

export interface AssessmentCaptureResult {
  readonly recognition: AssessmentRecognitionOutcome
  readonly durationMs: number
  readonly recordingAvailable: boolean
  readonly failure: FailedSpeechObservation | null
}

export type AssessmentCaptureState =
  | { readonly status: 'permission'; readonly result: null }
  | { readonly status: 'ready'; readonly result: null }
  | { readonly status: 'recording'; readonly result: null }
  | { readonly status: 'processing'; readonly result: null }
  | {
      readonly status: 'review'
      readonly result: AssessmentCaptureResult
      readonly playbackAvailable: boolean
    }
  | {
      readonly status: 'unavailable' | 'error'
      readonly result: AssessmentCaptureResult
      readonly playbackAvailable: boolean
    }

export interface AssessmentCaptureControllerOptions {
  readonly microphone?: MicrophonePermissionService
  readonly recorder?: SpeakingRecordingPort
  readonly recognition?: AssessmentSpeechRecognitionPort
  readonly isOnline?: () => boolean
}

export type AssessmentCaptureListener = (
  state: AssessmentCaptureState,
) => void

function failureReason(
  code: AssessmentRecognitionFailureCode,
  online: boolean,
): FailedSpeechObservation['reason'] {
  if (code === 'not-allowed' || code === 'service-not-allowed') {
    return 'permission-denied'
  }
  if (code === 'unavailable' || code === 'language-not-supported') {
    return 'recognizer-unavailable'
  }
  if (code === 'network' && !online) {
    return 'offline'
  }
  if (code === 'no-speech') {
    return 'no-speech'
  }
  return 'recognition-failed'
}

export class AssessmentCaptureController {
  readonly #microphone: MicrophonePermissionService
  readonly #recorder: SpeakingRecordingPort
  readonly #recognition: AssessmentSpeechRecognitionPort
  readonly #isOnline: () => boolean
  readonly #listeners = new Set<AssessmentCaptureListener>()
  #state: AssessmentCaptureState = {
    status: 'permission',
    result: null,
  }
  #recording: SpeakingRecording | null = null
  #recognitionHandle: AssessmentRecognitionHandle | null = null

  constructor(options: AssessmentCaptureControllerOptions = {}) {
    this.#microphone =
      options.microphone ?? browserMicrophonePermission
    this.#recorder = options.recorder ?? browserSpeakingRecorder
    this.#recognition =
      options.recognition ?? browserAssessmentSpeechRecognition
    this.#isOnline =
      options.isOnline ??
      (() => typeof navigator === 'undefined' || navigator.onLine)
  }

  get state(): AssessmentCaptureState {
    return this.#state
  }

  subscribe(listener: AssessmentCaptureListener): () => void {
    this.#listeners.add(listener)
    listener(this.#state)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  async initialize(): Promise<AssessmentCaptureState> {
    const permission = await this.#microphone.query()
    if (!this.#recorder.capabilities().supported) {
      return this.#setFailure(
        'recording-failed',
        false,
        'unavailable',
        { status: 'failed', code: 'audio-capture' },
      )
    }
    if (permission === 'denied' || permission === 'unsupported') {
      return this.#setFailure(
        'permission-denied',
        false,
        'unavailable',
        { status: 'failed', code: 'not-allowed' },
      )
    }
    return this.#setState({
      status: permission === 'granted' ? 'ready' : 'permission',
      result: null,
    })
  }

  async begin(): Promise<AssessmentCaptureState> {
    this.#discardRecording()
    let stream: MediaStream
    try {
      stream = await this.#microphone.request()
      this.#recorder.start(stream)
      this.#recognitionHandle = this.#recognition.start()
      return this.#setState({
        status: 'recording',
        result: null,
      })
    } catch {
      return this.#setFailure(
        'permission-denied',
        false,
        'unavailable',
        { status: 'failed', code: 'not-allowed' },
      )
    }
  }

  async finish(): Promise<AssessmentCaptureState> {
    const recognitionHandle = this.#recognitionHandle
    if (this.#state.status !== 'recording' || !recognitionHandle) {
      return this.#setFailure(
        'recording-failed',
        false,
        'error',
        { status: 'failed', code: 'audio-capture' },
      )
    }
    this.#setState({ status: 'processing', result: null })
    recognitionHandle.stop()
    try {
      const [recording, recognition] = await Promise.all([
        this.#recorder.stop(),
        recognitionHandle.result,
      ])
      this.#recording = recording
      this.#recognitionHandle = null
      if (recognition.status === 'failed') {
        return this.#setFailure(
          failureReason(recognition.code, this.#isOnline()),
          true,
          'review',
          recognition,
          recording.durationMs,
        )
      }
      return this.#setState({
        status: 'review',
        result: {
          recognition,
          durationMs: recording.durationMs,
          recordingAvailable: true,
          failure: null,
        },
        playbackAvailable: true,
      })
    } catch {
      recognitionHandle.abort()
      this.#recognitionHandle = null
      return this.#setFailure(
        'recording-failed',
        false,
        'error',
        { status: 'failed', code: 'audio-capture' },
      )
    }
  }

  async play(): Promise<void> {
    if (!this.#recording) {
      throw new TypeError('没有可回放的水平测试录音。')
    }
    await this.#recorder.play(this.#recording)
  }

  reset(): AssessmentCaptureState {
    this.#recognitionHandle?.abort()
    this.#recognitionHandle = null
    this.#recorder.cancel()
    this.#discardRecording()
    return this.#setState({ status: 'ready', result: null })
  }

  dispose(): void {
    this.#recognitionHandle?.abort()
    this.#recognitionHandle = null
    this.#discardRecording()
    this.#recorder.dispose()
    this.#listeners.clear()
  }

  #setFailure(
    reason: FailedSpeechObservation['reason'],
    recordingAvailable: boolean,
    status: 'review' | 'unavailable' | 'error',
    recognition: AssessmentRecognitionOutcome = {
      status: 'failed',
      code: 'unknown',
    },
    durationMs = 0,
  ): AssessmentCaptureState {
    const failure: FailedSpeechObservation = {
      status: 'unscorable',
      reason,
      recordingAvailable,
    }
    const result: AssessmentCaptureResult = {
      recognition,
      durationMs,
      recordingAvailable,
      failure,
    }
    if (status === 'review') {
      return this.#setState({
        status: 'review',
        result,
        playbackAvailable: recordingAvailable,
      })
    }
    if (status === 'unavailable') {
      return this.#setState({
        status: 'unavailable',
        result,
        playbackAvailable: recordingAvailable,
      })
    }
    return this.#setState({
      status: 'error',
      result,
      playbackAvailable: recordingAvailable,
    })
  }

  #discardRecording(): void {
    if (this.#recording) {
      this.#recorder.discard(this.#recording)
      this.#recording = null
    }
  }

  #setState(state: AssessmentCaptureState): AssessmentCaptureState {
    this.#state = state
    for (const listener of this.#listeners) {
      listener(state)
    }
    return state
  }
}
