import type { ListeningSpeechPort } from '../listening/index.ts'
import { browserListeningSpeech } from '../listening/index.ts'
import { type SpeakingGrowthUpgradeAdapter, type SpeakingGrowthUpgradePromptView, type SpeakingGrowthUpgradeSubmission } from './growth-upgrade.ts'
import { browserSpeakingRecognition } from './recognition.ts'
import { browserSpeakingRecorder } from './recording.ts'
import type { SpeakingRecognitionHandle, SpeakingRecognitionPort, SpeakingRecording, SpeakingRecordingPort } from './types.ts'

export type SpeakingGrowthUpgradeMediaStatus =
  | 'idle' | 'requesting-permission' | 'capturing' | 'stopping'
  | 'recognizing' | 'recorded' | 'playing' | 'feedback' | 'unscorable' | 'error'

export interface SpeakingGrowthUpgradeMediaView {
  readonly status: SpeakingGrowthUpgradeMediaStatus
  readonly prompt: SpeakingGrowthUpgradePromptView
  readonly recordingAvailable: boolean
  readonly referenceText: string | null
  readonly submission: SpeakingGrowthUpgradeSubmission | null
  readonly message: string | null
  readonly busy: boolean
  readonly retryable: boolean
}

export interface SpeakingGrowthUpgradeMediaSessionOptions {
  readonly adapter: SpeakingGrowthUpgradeAdapter
  readonly itemId: string
  readonly expectedDifficultyLevel: number
  readonly recorder?: SpeakingRecordingPort
  readonly recognition?: SpeakingRecognitionPort
  readonly speech?: ListeningSpeechPort
  readonly requestMicrophone?: () => Promise<MediaStream>
  readonly onView?: (view: SpeakingGrowthUpgradeMediaView) => void
}

function defaultMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('浏览器不支持麦克风录音。'))
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

/**
 * A deliberately narrow media controller for a single, already-selected R17
 * speaking item. It neither knows the plan nor writes scores. 01 receives a
 * submission only after the existing speaking adapter has assessed real
 * recognition text; recognition failure stays replayable and unscorable.
 */
export class SpeakingGrowthUpgradeMediaSession {
  readonly #adapter: SpeakingGrowthUpgradeAdapter
  readonly #itemId: string
  readonly #expectedDifficultyLevel: number
  readonly #recorder: SpeakingRecordingPort
  readonly #recognition: SpeakingRecognitionPort
  readonly #speech: ListeningSpeechPort
  readonly #requestMicrophone: () => Promise<MediaStream>
  readonly #listeners = new Set<(view: SpeakingGrowthUpgradeMediaView) => void>()
  #prompt: SpeakingGrowthUpgradePromptView | null = null
  #status: SpeakingGrowthUpgradeMediaStatus = 'idle'
  #recording: SpeakingRecording | null = null
  #submission: SpeakingGrowthUpgradeSubmission | null = null
  #message: string | null = null
  #handle: SpeakingRecognitionHandle | null = null
  #busy = false
  #generation = 0
  #disposed = false

  constructor(options: SpeakingGrowthUpgradeMediaSessionOptions) {
    this.#adapter = options.adapter
    this.#itemId = options.itemId
    this.#expectedDifficultyLevel = options.expectedDifficultyLevel
    this.#recorder = options.recorder ?? browserSpeakingRecorder
    this.#recognition = options.recognition ?? browserSpeakingRecognition
    this.#speech = options.speech ?? browserListeningSpeech
    this.#requestMicrophone = options.requestMicrophone ?? defaultMicrophone
    if (options.onView) this.#listeners.add(options.onView)
  }

  subscribe(listener: (view: SpeakingGrowthUpgradeMediaView) => void): () => void {
    this.#listeners.add(listener)
    if (this.#prompt) listener(this.current())
    return () => this.#listeners.delete(listener)
  }

  async initialize(): Promise<SpeakingGrowthUpgradeMediaView> {
    this.#ensureLive()
    this.#prompt = await this.#resolve(Boolean(this.#recording))
    this.#emit()
    return this.current()
  }

  current(): SpeakingGrowthUpgradeMediaView {
    if (!this.#prompt) throw new TypeError('Speaking upgrade media session is not initialized.')
    return {
      status: this.#status, prompt: this.#prompt,
      recordingAvailable: this.#recording !== null,
      referenceText: this.#recording ? this.#prompt.referenceText : null,
      submission: this.#submission, message: this.#message,
      busy: this.#busy, retryable: this.#status === 'unscorable' || this.#status === 'error',
    }
  }

  async startRecording(): Promise<SpeakingGrowthUpgradeMediaView> {
    this.#ensureReadyForCapture()
    const generation = ++this.#generation
    this.#busy = true; this.#status = 'requesting-permission'; this.#message = null; this.#emit()
    let stream: MediaStream | null = null
    try {
      stream = await this.#requestMicrophone()
      if (generation !== this.#generation || this.#disposed) { stream.getTracks().forEach((track) => track.stop()); return this.current() }
      this.#recorder.start(stream)
      this.#handle = this.#recognition.capabilities().supported ? this.#recognition.start('en-US') : null
      this.#status = 'capturing'
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop())
      this.#status = 'error'; this.#message = error instanceof Error ? error.message : '无法开启录音。'
    } finally { this.#busy = false; this.#emit() }
    return this.current()
  }

  async stopRecording(): Promise<SpeakingGrowthUpgradeSubmission | null> {
    this.#ensureLive()
    if (this.#busy || this.#status !== 'capturing') throw new TypeError('Speaking upgrade recording is not active.')
    const generation = this.#generation
    const handle = this.#handle
    this.#busy = true; this.#status = 'stopping'; this.#emit()
    try {
      handle?.stop()
      this.#recording = await this.#recorder.stop()
      if (generation !== this.#generation || this.#disposed) return null
      this.#status = 'recognizing'; this.#emit()
      const recognition = handle ? await handle.result : { status: 'failed' as const, code: 'unavailable' as const, message: '当前设备无法识别语音；录音仍可回放。' }
      if (generation !== this.#generation || this.#disposed) return null
      if (recognition.status !== 'recognized') {
        this.#status = 'unscorable'; this.#message = recognition.message; this.#emit(); return null
      }
      const result = await this.#adapter.submit({ domain: 'speaking', itemId: this.#itemId, expectedDifficultyLevel: this.#expectedDifficultyLevel, recognition, recording: { recordingId: this.#recording.id, durationMs: this.#recording.durationMs } })
      this.#submission = result
      this.#prompt = await this.#resolve(true)
      this.#status = result.scorable ? 'feedback' : 'unscorable'
      this.#message = result.scorable ? null : result.contentMatch.message
      this.#emit()
      return result
    } catch (error) {
      if (generation === this.#generation && !this.#disposed) { this.#status = this.#recording ? 'unscorable' : 'error'; this.#message = error instanceof Error ? error.message : '录音或识别失败。'; this.#emit() }
      return null
    } finally { this.#busy = false; this.#handle = null; this.#emit() }
  }

  async playRecording(): Promise<SpeakingGrowthUpgradeMediaView> {
    this.#ensureLive()
    if (!this.#recording || this.#busy || this.#status === 'capturing' || this.#status === 'stopping' || this.#status === 'recognizing') throw new TypeError('当前没有可播放的录音。')
    const restore = this.#status
    this.#busy = true; this.#status = 'playing'; this.#emit()
    try {
      await this.#recorder.play(this.#recording, {
        onStarted: () => undefined,
        onPaused: () => undefined,
        onWaiting: () => undefined,
        onEnded: () => undefined,
        onError: () => undefined,
      })
    } catch (error) { this.#message = error instanceof Error ? error.message : '录音播放失败。' } finally { this.#busy = false; this.#status = restore; this.#emit() }
    return this.current()
  }

  async playReference(): Promise<SpeakingGrowthUpgradeMediaView> {
    this.#ensureLive()
    if (!this.#recording || !this.#prompt?.referenceText || this.#busy) throw new TypeError('完成录音后才能播放示范原句。')
    const restore = this.#status
    this.#busy = true; this.#status = 'playing'; this.#emit()
    await new Promise<void>((resolve, reject) => {
      this.#speech.speak({ text: this.#prompt!.referenceText!, locale: 'en-US', rate: 1, usePreferredDeviceVoice: true }, { onEnd: resolve, onError: () => reject(new Error('示范原句播放失败。')) })
    }).catch((error) => { this.#message = error instanceof Error ? error.message : '示范原句播放失败。' })
    this.#busy = false; this.#status = restore; this.#emit()
    return this.current()
  }

  async retryRecognition(): Promise<SpeakingGrowthUpgradeSubmission | null> {
    if (!this.#recording) throw new TypeError('没有可重新识别的录音。')
    // Web speech recognition cannot safely consume a saved MediaRecorder blob.
    // The honest recovery is a new recording of the same persisted item.
    return null
  }

  async recordAgain(): Promise<SpeakingGrowthUpgradeMediaView> {
    this.#ensureLive()
    if (this.#busy) throw new TypeError('媒体操作仍在进行。')
    this.#speech.cancel(); this.#recorder.stopPlayback(); this.#handle?.abort(); this.#handle = null
    if (this.#recording) this.#recorder.discard(this.#recording)
    this.#recording = null; this.#submission = null; this.#message = null; this.#status = 'idle'
    this.#prompt = await this.#resolve(false); this.#emit()
    return this.current()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true; this.#generation += 1; this.#handle?.abort(); this.#speech.cancel(); this.#recorder.stopPlayback(); this.#recorder.cancel()
    if (this.#recording) this.#recorder.discard(this.#recording)
    this.#recording = null; this.#recorder.dispose(); this.#listeners.clear()
  }

  async #resolve(recordingExists: boolean): Promise<SpeakingGrowthUpgradePromptView> {
    return this.#adapter.resolve({ domain: 'speaking', itemId: this.#itemId, expectedDifficultyLevel: this.#expectedDifficultyLevel, recordingExists })
  }
  #ensureLive(): void { if (this.#disposed) throw new TypeError('Speaking upgrade media session is disposed.') }
  #ensureReadyForCapture(): void { this.#ensureLive(); if (!this.#prompt || this.#busy || !['idle', 'unscorable', 'error', 'recorded'].includes(this.#status)) throw new TypeError('Speaking upgrade recording cannot start while another operation is active.') }
  #emit(): void { if (!this.#prompt || this.#disposed) return; const view = this.current(); this.#listeners.forEach((listener) => listener(view)) }
}
