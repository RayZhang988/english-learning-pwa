import { ListeningError } from './errors.ts'
import type { ListeningPlaybackRate } from './types.ts'

export type ListeningSpeechErrorCode =
  | 'canceled'
  | 'interrupted'
  | 'audio-busy'
  | 'audio-hardware'
  | 'network'
  | 'synthesis-unavailable'
  | 'synthesis-failed'
  | 'language-unavailable'
  | 'voice-unavailable'
  | 'text-too-long'
  | 'invalid-argument'
  | 'unknown'

export interface ListeningSpeechRequest {
  readonly text: string
  readonly locale: 'en-US'
  readonly rate: ListeningPlaybackRate
}

export interface ListeningSpeechCallbacks {
  readonly onStart?: () => void
  readonly onEnd?: () => void
  readonly onPause?: () => void
  readonly onResume?: () => void
  readonly onError?: (code: ListeningSpeechErrorCode) => void
}

export interface ListeningSpeechCapabilities {
  readonly supported: boolean
  readonly voicesKnown: boolean
  readonly enUsVoiceAvailable: boolean
  readonly pauseResumeAvailable: boolean
  readonly supportedRates: readonly ListeningPlaybackRate[]
}

interface SpeechVoiceLike {
  readonly lang: string
  readonly localService: boolean
}

interface SpeechErrorEventLike {
  readonly error?: string
}

interface SpeechUtteranceLike {
  lang: string
  rate: number
  voice: SpeechVoiceLike | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onpause: (() => void) | null
  onresume: (() => void) | null
  onerror: ((event: SpeechErrorEventLike) => void) | null
}

interface SpeechSynthesisLike {
  readonly paused: boolean
  readonly speaking: boolean
  getVoices(): readonly SpeechVoiceLike[]
  speak(utterance: SpeechUtteranceLike): void
  pause(): void
  resume(): void
  cancel(): void
}

export interface ListeningSpeechPort {
  capabilities(): ListeningSpeechCapabilities
  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void
  pause(): void
  resume(): void
  cancel(): void
  isPaused(): boolean
  isSpeaking(): boolean
}

const SUPPORTED_RATES = [0.75, 1, 1.25] as const
const SPEECH_ERROR_CODES: readonly ListeningSpeechErrorCode[] = [
  'canceled',
  'interrupted',
  'audio-busy',
  'audio-hardware',
  'network',
  'synthesis-unavailable',
  'synthesis-failed',
  'language-unavailable',
  'voice-unavailable',
  'text-too-long',
  'invalid-argument',
]

function browserSynthesis(): SpeechSynthesisLike | undefined {
  if (
    typeof globalThis.speechSynthesis === 'undefined' ||
    typeof globalThis.SpeechSynthesisUtterance === 'undefined'
  ) {
    return undefined
  }
  return globalThis.speechSynthesis as unknown as SpeechSynthesisLike
}

function browserUtterance(text: string): SpeechUtteranceLike {
  return new globalThis.SpeechSynthesisUtterance(
    text,
  ) as unknown as SpeechUtteranceLike
}

function errorCode(value: string | undefined): ListeningSpeechErrorCode {
  return SPEECH_ERROR_CODES.includes(value as ListeningSpeechErrorCode)
    ? (value as ListeningSpeechErrorCode)
    : 'unknown'
}

export class BrowserListeningSpeechSynthesis
  implements ListeningSpeechPort
{
  private readonly synthesis: SpeechSynthesisLike | undefined
  private readonly createUtterance: (
    text: string,
  ) => SpeechUtteranceLike

  constructor(
    synthesis: SpeechSynthesisLike | undefined = browserSynthesis(),
    createUtterance: (text: string) => SpeechUtteranceLike =
      browserUtterance,
  ) {
    this.synthesis = synthesis
    this.createUtterance = createUtterance
  }

  capabilities(): ListeningSpeechCapabilities {
    if (!this.synthesis) {
      return {
        supported: false,
        voicesKnown: false,
        enUsVoiceAvailable: false,
        pauseResumeAvailable: false,
        supportedRates: [],
      }
    }
    const voices = this.synthesis.getVoices()
    return {
      supported: true,
      voicesKnown: voices.length > 0,
      enUsVoiceAvailable: voices.some(
        (voice) => voice.lang.toLowerCase() === 'en-us',
      ),
      pauseResumeAvailable: true,
      supportedRates: SUPPORTED_RATES,
    }
  }

  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    if (!this.synthesis) {
      throw new ListeningError(
        'speech-unavailable',
        'This browser does not expose the Web Speech synthesis API.',
      )
    }
    if (
      request.text.trim().length === 0 ||
      !SUPPORTED_RATES.includes(request.rate)
    ) {
      throw new ListeningError(
        'speech-failed',
        'The speech request has invalid text or playback rate.',
      )
    }
    const utterance = this.createUtterance(request.text)
    utterance.lang = request.locale
    utterance.rate = request.rate
    const voices = this.synthesis.getVoices()
    utterance.voice =
      voices.find(
        (voice) =>
          voice.lang.toLowerCase() === 'en-us' && voice.localService,
      ) ??
      voices.find((voice) => voice.lang.toLowerCase() === 'en-us') ??
      null
    utterance.onstart = callbacks.onStart ?? null
    utterance.onend = callbacks.onEnd ?? null
    utterance.onpause = callbacks.onPause ?? null
    utterance.onresume = callbacks.onResume ?? null
    utterance.onerror = callbacks.onError
      ? (event) => callbacks.onError?.(errorCode(event.error))
      : null
    this.synthesis.speak(utterance)
  }

  pause(): void {
    this.synthesis?.pause()
  }

  resume(): void {
    this.synthesis?.resume()
  }

  cancel(): void {
    this.synthesis?.cancel()
  }

  isPaused(): boolean {
    return this.synthesis?.paused ?? false
  }

  isSpeaking(): boolean {
    return this.synthesis?.speaking ?? false
  }
}

export const browserListeningSpeech =
  new BrowserListeningSpeechSynthesis()
