export type AssessmentRecognitionFailureCode =
  | 'aborted'
  | 'audio-capture'
  | 'language-not-supported'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'unavailable'
  | 'confidence-unavailable'
  | 'unknown'

export type AssessmentRecognitionOutcome =
  | {
      readonly status: 'recognized'
      readonly transcript: string
      readonly confidence: number
    }
  | {
      readonly status: 'failed'
      readonly code: AssessmentRecognitionFailureCode
    }

export interface AssessmentRecognitionHandle {
  readonly result: Promise<AssessmentRecognitionOutcome>
  stop(): void
  abort(): void
}

export interface AssessmentSpeechRecognitionPort {
  supported(): boolean
  start(): AssessmentRecognitionHandle
}

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
  readonly confidence?: number
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionResultListLike {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

interface SpeechRecognitionScope {
  readonly SpeechRecognition?: SpeechRecognitionConstructor
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor
}

function constructorFrom(
  scope: SpeechRecognitionScope,
): SpeechRecognitionConstructor | undefined {
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

function failureCode(value: string): AssessmentRecognitionFailureCode {
  const known: readonly AssessmentRecognitionFailureCode[] = [
    'aborted',
    'audio-capture',
    'language-not-supported',
    'network',
    'no-speech',
    'not-allowed',
    'service-not-allowed',
  ]
  return known.includes(value as AssessmentRecognitionFailureCode)
    ? (value as AssessmentRecognitionFailureCode)
    : 'unknown'
}

export class BrowserAssessmentSpeechRecognition
  implements AssessmentSpeechRecognitionPort
{
  readonly #scope: SpeechRecognitionScope

  constructor(
    scope: SpeechRecognitionScope =
      globalThis as unknown as SpeechRecognitionScope,
  ) {
    this.#scope = scope
  }

  supported(): boolean {
    return constructorFrom(this.#scope) !== undefined
  }

  start(): AssessmentRecognitionHandle {
    const Constructor = constructorFrom(this.#scope)
    if (!Constructor) {
      return {
        result: Promise.resolve({
          status: 'failed',
          code: 'unavailable',
        }),
        stop() {},
        abort() {},
      }
    }

    const recognition = new Constructor()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    let settled = false
    const transcriptParts: string[] = []
    const confidences: number[] = []
    let resolveResult:
      | ((outcome: AssessmentRecognitionOutcome) => void)
      | null = null
    const result = new Promise<AssessmentRecognitionOutcome>((resolve) => {
      resolveResult = resolve
    })
    const finish = (outcome: AssessmentRecognitionOutcome) => {
      if (settled) {
        return
      }
      settled = true
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      resolveResult?.(outcome)
      resolveResult = null
    }

    recognition.onresult = (event) => {
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const resultItem = event.results[index]
        const primary = resultItem?.[0]
        if (!resultItem?.isFinal || !primary) {
          continue
        }
        const transcript = primary.transcript.trim()
        if (transcript) {
          transcriptParts.push(transcript)
        }
        if (
          typeof primary.confidence === 'number' &&
          Number.isFinite(primary.confidence) &&
          primary.confidence >= 0 &&
          primary.confidence <= 1
        ) {
          confidences.push(primary.confidence)
        }
      }
    }
    recognition.onerror = (event) => {
      finish({
        status: 'failed',
        code: failureCode(event.error),
      })
    }
    recognition.onend = () => {
      const transcript = transcriptParts.join(' ').trim()
      if (!transcript) {
        finish({ status: 'failed', code: 'no-speech' })
        return
      }
      if (confidences.length === 0) {
        finish({
          status: 'failed',
          code: 'confidence-unavailable',
        })
        return
      }
      finish({
        status: 'recognized',
        transcript,
        confidence:
          confidences.reduce((sum, value) => sum + value, 0) /
          confidences.length,
      })
    }

    try {
      recognition.start()
    } catch {
      finish({ status: 'failed', code: 'unknown' })
    }

    return {
      result,
      stop() {
        if (!settled) {
          try {
            recognition.stop()
          } catch {
            finish({ status: 'failed', code: 'unknown' })
          }
        }
      },
      abort() {
        if (!settled) {
          try {
            recognition.abort()
          } finally {
            finish({ status: 'failed', code: 'aborted' })
          }
        }
      },
    }
  }
}

export const browserAssessmentSpeechRecognition =
  new BrowserAssessmentSpeechRecognition()
