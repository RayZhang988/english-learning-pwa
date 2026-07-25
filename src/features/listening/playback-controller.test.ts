import { describe, expect, it, vi } from 'vitest'
import { ListeningPlaybackController } from './playback-controller.ts'
import type {
  ListeningSpeechCallbacks,
  ListeningSpeechPort,
  ListeningSpeechRequest,
} from './speech-synthesis.ts'
import { choiceQuestion } from './test-fixtures.ts'
import type {
  ListeningPlaybackState,
  ListeningQuestion,
} from './types.ts'

interface FakeVoice {
  readonly id: string
  readonly locale: 'en-US'
  readonly localService: true
}

class FakeSpeech implements ListeningSpeechPort {
  readonly speakRequests: ListeningSpeechRequest[] = []
  callbacks: ListeningSpeechCallbacks | null = null
  paused = false
  speaking = false
  voiceCatalog: readonly FakeVoice[]
  readonly pauseSpy = vi.fn()
  readonly resumeSpy = vi.fn()
  readonly cancelSpy = vi.fn()

  constructor(voices: readonly FakeVoice[] = []) {
    this.voiceCatalog = voices
  }

  capabilities() {
    return {
      supported: true,
      voicesKnown: this.voiceCatalog.length > 0,
      enUsVoiceAvailable: this.voiceCatalog.length > 0,
      localEnUsVoiceCount: this.voiceCatalog.length,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
  }

  voices(): readonly FakeVoice[] {
    return this.voiceCatalog
  }

  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    this.speakRequests.push(request)
    this.callbacks = callbacks
    this.speaking = true
  }

  pause(): void {
    this.pauseSpy()
    this.paused = true
  }

  resume(): void {
    this.resumeSpy()
    this.paused = false
  }

  cancel(): void {
    this.cancelSpy()
    this.paused = false
    this.speaking = false
  }

  isPaused(): boolean {
    return this.paused
  }

  isSpeaking(): boolean {
    return this.speaking
  }
}

const initialState: ListeningPlaybackState = {
  status: 'idle',
  currentSegmentId: 'seg-word',
  rate: 1,
  repeatMode: 'none',
  playCounts: {},
  errorMessage: null,
}

const dialogueQuestion = {
  ...choiceQuestion,
  id: 'question-dialogue',
  type: 'core-information',
  primarySegmentId: 'line-a-1',
  segments: [
    {
      id: 'line-a-1',
      locale: 'en-US',
      text: 'Good morning.',
      label: 'Alex 的句子',
      speaker: 'Alex',
    },
    {
      id: 'line-b',
      locale: 'en-US',
      text: 'How can I help?',
      label: 'Blair 的句子',
      speaker: 'Blair',
    },
    {
      id: 'line-a-2',
      locale: 'en-US',
      text: 'I need a ticket.',
      label: 'Alex 的句子',
      speaker: 'Alex',
    },
  ],
  playbackPolicy: {
    allowSegmentSelection: true,
    allowRepeat: true,
    allowedRates: [0.75, 1, 1.25],
    sequenceMode: 'all-segments',
  },
} as ListeningQuestion

const dialogueInitialState: ListeningPlaybackState = {
  ...initialState,
  currentSegmentId: dialogueQuestion.primarySegmentId,
}

describe('listening playback controller', () => {
  it('plays, counts actual starts, pauses and resumes', () => {
    const speech = new FakeSpeech()
    const controller = new ListeningPlaybackController({
      question: choiceQuestion,
      initialState,
      speech,
    })
    controller.toggle()
    expect(speech.speakRequests[0]).toEqual({
      text: 'Maya',
      locale: 'en-US',
      rate: 1,
    })
    expect(controller.snapshot.playCounts).toEqual({})
    speech.callbacks?.onStart?.()
    expect(controller.snapshot).toMatchObject({
      status: 'playing',
      playCounts: { 'seg-word': 1 },
    })

    controller.toggle()
    expect(speech.pauseSpy).toHaveBeenCalledOnce()
    expect(controller.snapshot.status).toBe('paused')
    controller.toggle()
    expect(speech.resumeSpy).toHaveBeenCalledOnce()
    expect(controller.snapshot.status).toBe('playing')
  })

  it('validates content rates and segment-selection policy', () => {
    const controller = new ListeningPlaybackController({
      question: choiceQuestion,
      initialState,
      speech: new FakeSpeech(),
    })
    expect(() => controller.setRate(1.25)).toThrow(/not allowed/i)
    expect(() => controller.selectSegment('seg-sentence')).toThrow(
      /disabled/i,
    )
    expect(controller.setRate(0.75).rate).toBe(0.75)
  })

  it('repeats the selected segment and ignores stale cancel callbacks', () => {
    const speech = new FakeSpeech()
    const controller = new ListeningPlaybackController({
      question: choiceQuestion,
      initialState,
      speech,
    })
    controller.setRepeatMode('segment')
    controller.toggle()
    const firstCallbacks = speech.callbacks
    firstCallbacks?.onStart?.()
    firstCallbacks?.onEnd?.()
    expect(speech.speakRequests).toHaveLength(2)

    controller.interrupt()
    firstCallbacks?.onError?.('interrupted')
    expect(controller.snapshot.status).toBe('paused')
    expect(controller.snapshot.errorMessage).toBeNull()
  })

  it('surfaces active synthesis failures without scoring them', () => {
    const speech = new FakeSpeech()
    const onFailure = vi.fn()
    const controller = new ListeningPlaybackController({
      question: choiceQuestion,
      initialState,
      speech,
      onFailure,
    })
    controller.toggle()
    speech.callbacks?.onError?.('audio-busy')
    expect(controller.snapshot.status).toBe('error')
    expect(controller.snapshot.errorMessage).toContain('audio-busy')
    expect(onFailure).toHaveBeenCalledWith('audio-busy')
  })

  it('speaks a complete dialogue as one neutral continuous utterance', () => {
    const voices = [
      { id: 'voice-alex', locale: 'en-US', localService: true },
      { id: 'voice-blair', locale: 'en-US', localService: true },
    ] as const
    const speech = new FakeSpeech(voices)
    const controller = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech,
    })

    controller.toggle()
    speech.callbacks?.onStart?.()
    expect(speech.speakRequests).toEqual([
      {
        text: 'Good morning. How can I help? I need a ticket.',
        locale: 'en-US',
        rate: 1,
      },
    ])
    expect(speech.speakRequests[0].text).not.toMatch(/Alex:|Blair:/u)
    expect(controller.snapshot.playCounts).toEqual({
      'line-a-1': 1,
      'line-b': 1,
      'line-a-2': 1,
    })

    speech.callbacks?.onEnd?.()
    expect(controller.snapshot.status).toBe('ended')
    expect(speech.speakRequests).toHaveLength(1)
  })

  it('speaks only an explicitly selected line and preserves controls', () => {
    const speech = new FakeSpeech([
      { id: 'late-a', locale: 'en-US', localService: true },
      { id: 'late-b', locale: 'en-US', localService: true },
    ])
    const controller = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech,
    })

    controller.selectSegment('line-b')
    controller.setRate(0.75)
    controller.toggle()
    expect(speech.speakRequests.at(-1)).toEqual({
      text: 'How can I help?',
      locale: 'en-US',
      rate: 0.75,
    })
    controller.toggle()
    expect(speech.pauseSpy).toHaveBeenCalledOnce()
    controller.toggle()
    expect(speech.resumeSpy).toHaveBeenCalledOnce()
    controller.setRate(1.25)
    expect(controller.snapshot.status).toBe('idle')
    expect(speech.cancelSpy).toHaveBeenCalled()
    controller.toggle()
    expect(speech.speakRequests.at(-1)).toEqual({
      text: 'How can I help?',
      locale: 'en-US',
      rate: 1.25,
    })
    controller.interrupt()
    expect(speech.cancelSpy).toHaveBeenCalled()
  })

  it('repeats a selected line or the complete continuous dialogue honestly', () => {
    const speech = new FakeSpeech()
    const controller = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech,
    })

    controller.selectSegment('line-b')
    controller.setRepeatMode('segment')
    controller.toggle()
    speech.callbacks?.onEnd?.()
    expect(speech.speakRequests.map(({ text }) => text)).toEqual([
      'How can I help?',
      'How can I help?',
    ])

    controller.setRepeatMode('all')
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()
    expect(speech.speakRequests.slice(2).map(({ text }) => text)).toEqual([
      'Good morning. How can I help? I need a ticket.',
      'Good morning. How can I help? I need a ticket.',
    ])
  })
})
