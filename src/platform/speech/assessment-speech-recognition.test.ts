import { describe, expect, it } from 'vitest'
import { BrowserAssessmentSpeechRecognition } from './assessment-speech-recognition.ts'

class FakeRecognition {
  static last: FakeRecognition | null = null

  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 0
  onresult: ((event: {
    readonly resultIndex: number
    readonly results: {
      readonly length: number
      readonly [index: number]: {
        readonly isFinal: boolean
        readonly length: number
        readonly [index: number]: {
          readonly transcript: string
          readonly confidence?: number
        }
      }
    }
  }) => void) | null = null
  onerror: ((event: { readonly error: string }) => void) | null = null
  onend: (() => void) | null = null

  constructor() {
    FakeRecognition.last = this
  }

  start() {}
  stop() {}
  abort() {}
}

function scope() {
  return {
    webkitSpeechRecognition:
      FakeRecognition as unknown as new () => never,
  }
}

describe('BrowserAssessmentSpeechRecognition', () => {
  it('preserves the recognizer confidence as evidence reliability', async () => {
    const recognition = new BrowserAssessmentSpeechRecognition(scope())
    const handle = recognition.start()
    const active = FakeRecognition.last
    if (!active) {
      throw new Error('Expected a speech recognition instance.')
    }

    active.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: true,
          length: 1,
          0: {
            transcript: '  I need a quiet room  ',
            confidence: 0.82,
          },
        },
      },
    })
    active.onend?.()

    await expect(handle.result).resolves.toEqual({
      status: 'recognized',
      transcript: 'I need a quiet room',
      confidence: 0.82,
    })
  })

  it('does not invent confidence when Safari omits it', async () => {
    const recognition = new BrowserAssessmentSpeechRecognition(scope())
    const handle = recognition.start()
    const active = FakeRecognition.last
    if (!active) {
      throw new Error('Expected a speech recognition instance.')
    }

    active.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: true,
          length: 1,
          0: {
            transcript: 'I need a quiet room',
          },
        },
      },
    })
    active.onend?.()

    await expect(handle.result).resolves.toEqual({
      status: 'failed',
      code: 'confidence-unavailable',
    })
  })

  it('returns an explicit unavailable result without a browser API', async () => {
    const recognition = new BrowserAssessmentSpeechRecognition({})

    expect(recognition.supported()).toBe(false)
    await expect(recognition.start().result).resolves.toEqual({
      status: 'failed',
      code: 'unavailable',
    })
  })
})
