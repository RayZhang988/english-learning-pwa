import { describe, expect, it, vi } from 'vitest'
import { ListeningPlaybackController } from './playback-controller.ts'
import { ListeningSpeakerVoiceProfiles } from './speaker-voice-profiles.ts'
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
      pitch: 1,
      voiceId: null,
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

  it('queues only dialogue text and keeps A/B/A on stable distinct voices', () => {
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
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onStart?.()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onStart?.()
    speech.callbacks?.onEnd?.()

    expect(speech.speakRequests.map((request) => request.text)).toEqual([
      'Good morning.',
      'How can I help?',
      'I need a ticket.',
    ])
    expect(speech.speakRequests.map((request) => request.voiceId)).toEqual([
      'voice-alex',
      'voice-blair',
      'voice-alex',
    ])
    expect(speech.speakRequests.map((request) => request.pitch)).toEqual([
      1,
      1,
      1,
    ])
    expect(controller.snapshot.status).toBe('ended')
  })

  it('distinguishes speakers gently on one local voice without crossing rate bounds', () => {
    const speech = new FakeSpeech([
      { id: 'voice-only', locale: 'en-US', localService: true },
    ])
    const controller = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech,
    })

    controller.toggle()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()

    const [firstAlex, blair, secondAlex] = speech.speakRequests
    expect(firstAlex.voiceId).toBe('voice-only')
    expect(blair.voiceId).toBe('voice-only')
    expect(secondAlex).toMatchObject({
      voiceId: firstAlex.voiceId,
      pitch: firstAlex.pitch,
      rate: firstAlex.rate,
    })
    expect(blair.pitch).not.toBe(firstAlex.pitch)
    expect(
      Math.abs((blair.pitch ?? 1) - (firstAlex.pitch ?? 1)),
    ).toBeLessThanOrEqual(0.1)
    expect(
      Math.abs(blair.rate - firstAlex.rate),
    ).toBeLessThanOrEqual(0.05)
    for (const request of speech.speakRequests) {
      expect(request.rate).toBeGreaterThanOrEqual(0.75)
      expect(request.rate).toBeLessThanOrEqual(1.25)
    }
  })

  it('clamps single-voice fallback differences at content speed boundaries', () => {
    for (const rate of [0.75, 1.25] as const) {
      const speech = new FakeSpeech([
        { id: 'voice-only', locale: 'en-US', localService: true },
      ])
      const controller = new ListeningPlaybackController({
        question: dialogueQuestion,
        initialState: { ...dialogueInitialState, rate },
        speech,
      })

      controller.toggle()
      speech.callbacks?.onEnd?.()

      expect(speech.speakRequests).toHaveLength(2)
      for (const request of speech.speakRequests) {
        expect(request.rate).toBeGreaterThanOrEqual(0.75)
        expect(request.rate).toBeLessThanOrEqual(1.25)
      }
    }
  })

  it('keeps a single narrator neutral and stable across queued lines', () => {
    const speech = new FakeSpeech([
      { id: 'narrator-a', locale: 'en-US', localService: true },
      { id: 'narrator-b', locale: 'en-US', localService: true },
    ])
    const narrativeQuestion = {
      ...dialogueQuestion,
      id: 'question-narrative',
      segments: dialogueQuestion.segments.map((segment) => ({
        ...segment,
        speaker: null,
      })),
    } as ListeningQuestion
    const controller = new ListeningPlaybackController({
      question: narrativeQuestion,
      initialState: dialogueInitialState,
      speech,
    })

    controller.toggle()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()

    expect(
      speech.speakRequests.map(({ voiceId, pitch, rate }) => ({
        voiceId,
        pitch,
        rate,
      })),
    ).toEqual([
      { voiceId: 'narrator-a', pitch: 1, rate: 1 },
      { voiceId: 'narrator-a', pitch: 1, rate: 1 },
      { voiceId: 'narrator-a', pitch: 1, rate: 1 },
    ])
  })

  it('uses gentle profile differences when the local voice list is empty', () => {
    const speech = new FakeSpeech()
    const controller = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech,
    })

    controller.toggle()
    speech.callbacks?.onEnd?.()

    expect(speech.speakRequests).toHaveLength(2)
    expect(speech.speakRequests.map(({ voiceId }) => voiceId)).toEqual([
      null,
      null,
    ])
    expect(speech.speakRequests[0].pitch).not.toBe(
      speech.speakRequests[1].pitch,
    )
  })

  it('uses voices that load before playback and preserves queue controls', () => {
    const speech = new FakeSpeech()
    const controller = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech,
    })
    speech.voiceCatalog = [
      { id: 'late-a', locale: 'en-US', localService: true },
      { id: 'late-b', locale: 'en-US', localService: true },
    ]

    controller.selectSegment('line-b')
    controller.setRate(0.75)
    controller.toggle()
    expect(speech.speakRequests.at(-1)).toMatchObject({
      text: 'How can I help?',
      voiceId: 'late-b',
    })
    controller.toggle()
    expect(speech.pauseSpy).toHaveBeenCalledOnce()
    controller.toggle()
    expect(speech.resumeSpy).toHaveBeenCalledOnce()
    controller.setRate(1.25)
    expect(controller.snapshot.status).toBe('idle')
    expect(speech.cancelSpy).toHaveBeenCalled()
    controller.toggle()
    expect(speech.speakRequests.at(-1)?.rate).toBe(1.25)
    controller.interrupt()
    expect(speech.cancelSpy).toHaveBeenCalled()

    controller.selectSegment('line-a-1')
    controller.setRepeatMode('all')
    controller.toggle()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()
    speech.callbacks?.onEnd?.()
    expect(speech.speakRequests.at(-1)?.text).toBe('Good morning.')
  })

  it('shares one frozen speaker map across question controllers in the same session', () => {
    const initialVoices = [
      { id: 'session-a', locale: 'en-US', localService: true },
      { id: 'session-b', locale: 'en-US', localService: true },
    ] as const
    let currentVoices: readonly FakeVoice[] = initialVoices
    const profiles = new ListeningSpeakerVoiceProfiles(
      ['Alex', 'Blair'],
      () => currentVoices,
    )
    const firstSpeech = new FakeSpeech(initialVoices)
    const firstController = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech: firstSpeech,
      speakerVoiceProfiles: profiles,
    })

    firstController.toggle()
    expect(firstSpeech.speakRequests[0].voiceId).toBe('session-a')

    currentVoices = [...initialVoices].reverse()
    const secondSpeech = new FakeSpeech(currentVoices)
    const secondController = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: {
        ...dialogueInitialState,
        currentSegmentId: 'line-b',
      },
      speech: secondSpeech,
      speakerVoiceProfiles: profiles,
    })
    secondController.toggle()
    expect(secondSpeech.speakRequests[0].voiceId).toBe('session-b')

    const thirdSpeech = new FakeSpeech(currentVoices)
    const thirdController = new ListeningPlaybackController({
      question: dialogueQuestion,
      initialState: dialogueInitialState,
      speech: thirdSpeech,
      speakerVoiceProfiles: profiles,
    })
    thirdController.toggle()
    expect(thirdSpeech.speakRequests[0].voiceId).toBe('session-a')
  })
})
