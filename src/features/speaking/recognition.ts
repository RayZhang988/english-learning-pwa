import type {
  SpeakingRecognitionErrorCode,
  SpeakingRecognitionHandle,
  SpeakingRecognitionOutcome,
  SpeakingRecognitionPort,
} from './types.ts'

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string
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
  readonly message?: string
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult:
    | ((event: SpeechRecognitionEventLike) => void)
    | null
  onerror:
    | ((event: SpeechRecognitionErrorEventLike) => void)
    | null
  onend: ((event: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionConstructor =
  new () => SpeechRecognitionLike

interface SpeechRecognitionScope {
  readonly SpeechRecognition?: SpeechRecognitionConstructor
  readonly webkitSpeechRecognition?: SpeechRecognitionConstructor
}

function constructorFrom(
  scope: SpeechRecognitionScope,
): SpeechRecognitionConstructor | undefined {
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

function errorCode(value: string): SpeakingRecognitionErrorCode {
  const supported: readonly SpeakingRecognitionErrorCode[] = [
    'aborted',
    'audio-capture',
    'language-not-supported',
    'network',
    'no-speech',
    'not-allowed',
    'service-not-allowed',
  ]
  return supported.includes(value as SpeakingRecognitionErrorCode)
    ? value as SpeakingRecognitionErrorCode
    : 'unknown'
}

function errorMessage(code: SpeakingRecognitionErrorCode): string {
  switch (code) {
    case 'aborted':
      return '语音识别被中断；录音仍可回放。'
    case 'audio-capture':
      return '语音识别无法访问音频；录音仍可回放。'
    case 'language-not-supported':
      return '设备语音识别不支持 en-US；录音仍可回放。'
    case 'network':
      return '语音识别网络失败；录音仍可回放。'
    case 'no-speech':
      return '语音识别没有得到可用文本；请回放录音自查。'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Siri 语音识别未获允许或不可用；录音仍可回放。'
    default:
      return '语音识别失败；录音仍可回放。'
  }
}

export class BrowserSpeakingRecognition
  implements SpeakingRecognitionPort
{
  private readonly scope: SpeechRecognitionScope

  constructor(
    scope: SpeechRecognitionScope =
      globalThis as unknown as SpeechRecognitionScope,
  ) {
    this.scope = scope
  }

  capabilities() {
    return {
      supported: constructorFrom(this.scope) !== undefined,
      requiresSiri: true,
    }
  }

  start(locale: 'en-US'): SpeakingRecognitionHandle {
    const Constructor = constructorFrom(this.scope)
    if (!Constructor) {
      return {
        result: Promise.resolve({
          status: 'failed',
          code: 'unavailable',
          message: '当前 Safari 未提供语音识别；录音仍可回放。',
        }),
        stop() {},
        abort() {},
      }
    }

    const recognition = new Constructor()
    recognition.lang = locale
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 3

    let settled = false
    let transcript = ''
    const alternatives = new Set<string>()
    let resolveResult:
      | ((outcome: SpeakingRecognitionOutcome) => void)
      | null = null
    const result = new Promise<SpeakingRecognitionOutcome>((resolve) => {
      resolveResult = resolve
    })

    const cleanup = () => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
    }
    const finish = (outcome: SpeakingRecognitionOutcome) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolveResult?.(outcome)
      resolveResult = null
    }

    recognition.onresult = (event) => {
      const primaryParts: string[] = []
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const recognitionResult = event.results[index]
        if (!recognitionResult?.isFinal || recognitionResult.length === 0) {
          continue
        }
        const primary = recognitionResult[0]?.transcript.trim()
        if (primary) {
          primaryParts.push(primary)
        }
        for (
          let alternativeIndex = 0;
          alternativeIndex < recognitionResult.length;
          alternativeIndex += 1
        ) {
          const alternative =
            recognitionResult[alternativeIndex]?.transcript.trim()
          if (alternative) {
            alternatives.add(alternative)
          }
        }
      }
      if (primaryParts.length > 0) {
        transcript = [transcript, ...primaryParts]
          .filter(Boolean)
          .join(' ')
      }
    }
    recognition.onerror = (event) => {
      const code = errorCode(event.error)
      finish({
        status: 'failed',
        code,
        message: event.message?.trim() || errorMessage(code),
      })
    }
    recognition.onend = () => {
      if (transcript.trim().length === 0) {
        finish({
          status: 'failed',
          code: 'no-speech',
          message: errorMessage('no-speech'),
        })
        return
      }
      finish({
        status: 'recognized',
        transcript: transcript.trim(),
        alternatives: [...alternatives],
      })
    }

    try {
      recognition.start()
    } catch (error) {
      finish({
        status: 'failed',
        code: 'unknown',
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : errorMessage('unknown'),
      })
    }

    return {
      result,
      stop() {
        if (!settled) {
          try {
            recognition.stop()
          } catch {
            finish({
              status: 'failed',
              code: 'unknown',
              message: errorMessage('unknown'),
            })
          }
        }
      },
      abort() {
        if (!settled) {
          try {
            recognition.abort()
          } finally {
            finish({
              status: 'failed',
              code: 'aborted',
              message: errorMessage('aborted'),
            })
          }
        }
      },
    }
  }
}

export const browserSpeakingRecognition =
  new BrowserSpeakingRecognition()
