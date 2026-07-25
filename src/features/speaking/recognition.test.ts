import { describe, expect, it } from 'vitest'
import { BrowserSpeakingRecognition } from './recognition.ts'

interface Alternative {
  readonly transcript: string
}

interface Result {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: Alternative
}

class FakeRecognition {
  static latest: FakeRecognition | null = null

  lang = ''
  continuous = true
  interimResults = true
  maxAlternatives = 1
  onresult: ((event: never) => void) | null = null
  onerror: ((event: never) => void) | null = null
  onend: ((event: Event) => void) | null = null

  constructor() {
    FakeRecognition.latest = this
  }

  start() {}
  stop() {
    this.onend?.(new Event('end'))
  }
  abort() {}

  recognize(...transcripts: string[]) {
    const result = {
      isFinal: true,
      length: transcripts.length,
      ...Object.fromEntries(
        transcripts.map((transcript, index) => [
          index,
          { transcript },
        ]),
      ),
    } as Result
    this.onresult?.({
      resultIndex: 0,
      results: { 0: result, length: 1 },
    } as never)
  }

  fail(error: string) {
    this.onerror?.({ error } as never)
  }
}

function fakeScope() {
  return {
    webkitSpeechRecognition:
      FakeRecognition as unknown as new () => never,
  }
}

describe('browser speaking recognition', () => {
  it('uses Safari prefixed recognition with en-US and alternatives', async () => {
    const port = new BrowserSpeakingRecognition(fakeScope())
    const handle = port.start('en-US')
    const recognition = FakeRecognition.latest
    if (!recognition) {
      throw new Error('Expected a recognition instance.')
    }

    recognition.recognize(
      'I am from Shanghai',
      "I'm from Shanghai",
    )
    handle.stop()
    const outcome = await handle.result

    expect(recognition.lang).toBe('en-US')
    expect(recognition.maxAlternatives).toBe(3)
    expect(outcome).toEqual({
      status: 'recognized',
      transcript: 'I am from Shanghai',
      alternatives: [
        'I am from Shanghai',
        "I'm from Shanghai",
      ],
    })
  })

  it('turns network failure into an explicit fallback outcome', async () => {
    const port = new BrowserSpeakingRecognition(fakeScope())
    const handle = port.start('en-US')
    FakeRecognition.latest?.fail('network')

    await expect(handle.result).resolves.toMatchObject({
      status: 'failed',
      code: 'network',
    })
  })

  it('feature-detects recognition instead of assuming Siri is available', async () => {
    const port = new BrowserSpeakingRecognition({})

    expect(port.capabilities()).toEqual({
      supported: false,
      requiresSiri: true,
    })
    await expect(port.start('en-US').result).resolves.toMatchObject({
      status: 'failed',
      code: 'unavailable',
    })
  })
})
