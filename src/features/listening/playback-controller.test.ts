import { describe, expect, it, vi } from 'vitest'
import { ListeningPlaybackController } from './playback-controller.ts'
import type {
  ListeningSpeechCallbacks,
  ListeningSpeechPort,
  ListeningSpeechRequest,
} from './speech-synthesis.ts'
import { choiceQuestion } from './test-fixtures.ts'
import type { ListeningPlaybackState } from './types.ts'

class FakeSpeech implements ListeningSpeechPort {
  readonly speakRequests: ListeningSpeechRequest[] = []
  callbacks: ListeningSpeechCallbacks | null = null
  paused = false
  speaking = false
  readonly pauseSpy = vi.fn()
  readonly resumeSpy = vi.fn()
  readonly cancelSpy = vi.fn()

  capabilities() {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: true,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25] as const,
    }
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
})
