import { describe, expect, it, vi } from 'vitest'
import {
  BrowserListeningSpeechSynthesis,
  type ListeningSpeechCallbacks,
} from './speech-synthesis.ts'

function createFakeSpeech() {
  const localVoice = { lang: 'en-US', localService: true }
  const remoteVoice = { lang: 'en-US', localService: false }
  const synthesis = {
    paused: false,
    speaking: false,
    getVoices: () => [remoteVoice, localVoice],
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  }
  const utterance = {
    lang: '',
    rate: 1,
    voice: null as (typeof localVoice) | null,
    onstart: null as (() => void) | null,
    onend: null as (() => void) | null,
    onpause: null as (() => void) | null,
    onresume: null as (() => void) | null,
    onerror: null as
      | ((event: { readonly error?: string }) => void)
      | null,
  }
  return { synthesis, utterance, localVoice }
}

describe('browser listening speech synthesis', () => {
  it('detects unsupported browsers without pretending a voice exists', () => {
    const speech = new BrowserListeningSpeechSynthesis(undefined)
    expect(speech.capabilities()).toEqual({
      supported: false,
      voicesKnown: false,
      enUsVoiceAvailable: false,
      pauseResumeAvailable: false,
      supportedRates: [],
    })
    expect(() =>
      speech.speak(
        { text: 'Hello', locale: 'en-US', rate: 1 },
        {},
      ),
    ).toThrow(/does not expose/i)
  })

  it('configures en-US, rate, local voice and lifecycle callbacks', () => {
    const { synthesis, utterance, localVoice } = createFakeSpeech()
    const callbacks: ListeningSpeechCallbacks = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      onError: vi.fn(),
    }
    const speech = new BrowserListeningSpeechSynthesis(
      synthesis,
      () => utterance,
    )
    speech.speak(
      { text: 'Boston', locale: 'en-US', rate: 0.75 },
      callbacks,
    )
    expect(utterance).toMatchObject({
      lang: 'en-US',
      rate: 0.75,
      voice: localVoice,
    })
    expect(synthesis.speak).toHaveBeenCalledWith(utterance)
    utterance.onstart?.()
    utterance.onend?.()
    utterance.onerror?.({ error: 'network' })
    expect(callbacks.onStart).toHaveBeenCalledOnce()
    expect(callbacks.onEnd).toHaveBeenCalledOnce()
    expect(callbacks.onError).toHaveBeenCalledWith('network')
  })

  it('delegates pause, resume and cancel to the browser queue', () => {
    const { synthesis, utterance } = createFakeSpeech()
    const speech = new BrowserListeningSpeechSynthesis(
      synthesis,
      () => utterance,
    )
    speech.pause()
    speech.resume()
    speech.cancel()
    expect(synthesis.pause).toHaveBeenCalledOnce()
    expect(synthesis.resume).toHaveBeenCalledOnce()
    expect(synthesis.cancel).toHaveBeenCalledOnce()
  })
})
