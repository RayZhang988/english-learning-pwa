import { describe, expect, it, vi } from 'vitest'
import {
  BrowserListeningSpeechSynthesis,
  type ListeningSpeechCallbacks,
} from './speech-synthesis.ts'

function createFakeSpeech() {
  const localVoice = {
    lang: 'en-US',
    localService: true,
    name: 'Local Voice',
    voiceURI: 'local-voice',
  }
  const secondLocalVoice = {
    lang: 'en-US',
    localService: true,
    name: 'Second Local Voice',
    voiceURI: 'second-local-voice',
  }
  const remoteVoice = {
    lang: 'en-US',
    localService: false,
    name: 'Remote Voice',
    voiceURI: 'remote-voice',
  }
  let voices = [remoteVoice, localVoice, secondLocalVoice]
  const synthesis = {
    paused: false,
    speaking: false,
    getVoices: () => voices,
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  }
  const utterance = {
    lang: '',
    rate: 1,
    pitch: 1,
    voice: null as (typeof localVoice) | null,
    onstart: null as (() => void) | null,
    onend: null as (() => void) | null,
    onpause: null as (() => void) | null,
    onresume: null as (() => void) | null,
    onerror: null as
      | ((event: { readonly error?: string }) => void)
      | null,
  }
  return {
    synthesis,
    utterance,
    localVoice,
    setVoices: (
      next: typeof voices,
    ) => {
      voices = next
    },
  }
}

describe('browser listening speech synthesis', () => {
  it('detects unsupported browsers without pretending a voice exists', () => {
    const speech = new BrowserListeningSpeechSynthesis(undefined)
    expect(speech.capabilities()).toEqual({
      supported: false,
      voicesKnown: false,
      enUsVoiceAvailable: false,
      localEnUsVoiceCount: 0,
      pauseResumeAvailable: false,
      supportedRates: [],
    })
    expect(() =>
      speech.speak(
        {
          text: 'Hello',
          locale: 'en-US',
          rate: 1,
          pitch: 1,
          voiceId: null,
        },
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
      {
        text: 'Boston',
        locale: 'en-US',
        rate: 0.75,
        pitch: 1.03,
        voiceId: 'local-voice',
      },
      callbacks,
    )
    expect(utterance).toMatchObject({
      lang: 'en-US',
      rate: 0.75,
      pitch: 1.03,
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

  it('refreshes an asynchronously populated local voice list and excludes remote voices', () => {
    const { synthesis, utterance, setVoices } = createFakeSpeech()
    setVoices([])
    const speech = new BrowserListeningSpeechSynthesis(
      synthesis,
      () => utterance,
    )

    expect(speech.capabilities()).toMatchObject({
      voicesKnown: false,
      enUsVoiceAvailable: false,
      localEnUsVoiceCount: 0,
    })
    expect(speech.voices()).toEqual([])

    setVoices([
      {
        lang: 'en-US',
        localService: false,
        name: 'Remote Voice',
        voiceURI: 'remote-voice',
      },
      {
        lang: 'en-US',
        localService: true,
        name: 'Late Local Voice',
        voiceURI: 'late-local-voice',
      },
    ])
    expect(speech.capabilities()).toMatchObject({
      voicesKnown: true,
      enUsVoiceAvailable: true,
      localEnUsVoiceCount: 1,
    })
    expect(speech.voices()).toEqual([
      {
        id: 'late-local-voice',
        locale: 'en-US',
        localService: true,
      },
    ])
  })

  it('uses a neutral browser fallback when no local en-US voice is exposed', () => {
    const { synthesis, utterance, setVoices } = createFakeSpeech()
    setVoices([])
    const speech = new BrowserListeningSpeechSynthesis(
      synthesis,
      () => utterance,
    )

    speech.speak(
      {
        text: 'The train is on time.',
        locale: 'en-US',
        rate: 1.02,
        pitch: 0.97,
        voiceId: null,
      },
      {},
    )

    expect(utterance).toMatchObject({
      lang: 'en-US',
      rate: 1.02,
      pitch: 0.97,
      voice: null,
    })
  })

  it('treats a temporarily throwing Safari voice list as unknown rather than unsupported', () => {
    const { synthesis, utterance } = createFakeSpeech()
    const throwingSynthesis = {
      ...synthesis,
      getVoices: () => {
        throw new Error('voices are still loading')
      },
    }
    const speech = new BrowserListeningSpeechSynthesis(
      throwingSynthesis,
      () => utterance,
    )

    expect(speech.capabilities()).toMatchObject({
      supported: true,
      voicesKnown: false,
      enUsVoiceAvailable: false,
      localEnUsVoiceCount: 0,
    })
    expect(speech.voices()).toEqual([])
    expect(() =>
      speech.speak(
        {
          text: 'Please wait.',
          locale: 'en-US',
          rate: 1,
          pitch: 1,
          voiceId: null,
        },
        {},
      ),
    ).not.toThrow()
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
