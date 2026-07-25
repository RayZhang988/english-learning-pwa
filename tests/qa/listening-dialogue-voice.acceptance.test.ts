import { describe, expect, it } from 'vitest'
import {
  ListeningPlaybackController,
  type ListeningPlaybackState,
  type ListeningQuestion,
  type ListeningSpeechCallbacks,
  type ListeningSpeechCapabilities,
  type ListeningSpeechPort,
  type ListeningSpeechRequest,
  type ListeningSpeechVoice,
  type ListeningTrainingUnit,
} from '../../src/features/listening/index.ts'
import { releasedCatalogs } from './fixtures/production-course.ts'

const TWO_LOCAL_EN_US_VOICES = [
  { id: 'qa-local-a', locale: 'en-US', localService: true },
  { id: 'qa-local-b', locale: 'en-US', localService: true },
] as const
const ONE_LOCAL_EN_US_VOICE = TWO_LOCAL_EN_US_VOICES.slice(0, 1)

class RecordingSpeech implements ListeningSpeechPort {
  readonly requests: ListeningSpeechRequest[] = []
  pauseCount = 0
  resumeCount = 0
  cancelCount = 0
  private activeCallbacks: ListeningSpeechCallbacks | null = null
  private paused = false
  private speaking = false

  constructor(
    private readonly availableVoices:
      readonly ListeningSpeechVoice[],
  ) {}

  capabilities(): ListeningSpeechCapabilities {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: this.availableVoices.length > 0,
      localEnUsVoiceCount: this.availableVoices.length,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25],
    }
  }

  voices(): readonly ListeningSpeechVoice[] {
    return this.availableVoices
  }

  speak(
    request: ListeningSpeechRequest,
    callbacks: ListeningSpeechCallbacks,
  ): void {
    this.requests.push(request)
    this.activeCallbacks = callbacks
    this.paused = false
    this.speaking = true
  }

  pause(): void {
    if (!this.speaking || this.paused) return
    this.paused = true
    this.pauseCount += 1
    this.activeCallbacks?.onPause?.()
  }

  resume(): void {
    if (!this.speaking || !this.paused) return
    this.paused = false
    this.resumeCount += 1
    this.activeCallbacks?.onResume?.()
  }

  cancel(): void {
    this.activeCallbacks = null
    this.paused = false
    this.speaking = false
    this.cancelCount += 1
  }

  isPaused(): boolean {
    return this.paused
  }

  isSpeaking(): boolean {
    return this.speaking
  }

  completeCurrent(): void {
    const callbacks = this.activeCallbacks
    if (!callbacks) {
      throw new Error('No active utterance to complete.')
    }
    callbacks.onStart?.()
    this.activeCallbacks = null
    this.paused = false
    this.speaking = false
    callbacks.onEnd?.()
  }
}

function fullSceneQuestion(
  unit: ListeningTrainingUnit,
): ListeningQuestion {
  const question = unit.questions.find(
    (entry) =>
      entry.playbackPolicy.sequenceMode === 'all-segments',
  )
  if (!question) {
    throw new Error(
      `Listening unit ${unit.contentRef} has no full-scene question.`,
    )
  }
  return question
}

function initialPlayback(
  question: ListeningQuestion,
): ListeningPlaybackState {
  return {
    status: 'idle',
    currentSegmentId: question.primarySegmentId,
    rate: 1,
    repeatMode: 'none',
    playCounts: {},
    errorMessage: null,
  }
}

function completeScene(
  speech: RecordingSpeech,
  segmentCount: number,
): void {
  for (let index = 0; index < segmentCount; index += 1) {
    speech.completeCurrent()
  }
}

describe('released listening dialogue voice acceptance', () => {
  it('keeps all 21 dialogue speaker labels outside 143 spoken lines', () => {
    const dialogueUnits = releasedCatalogs().listening.units.filter(
      (unit) => unit.activityType === 'listening-dialogue',
    )
    expect(dialogueUnits).toHaveLength(21)
    expect(
      dialogueUnits.reduce(
        (total, unit) => total + unit.transcript.length,
        0,
      ),
    ).toBe(143)

    for (const unit of dialogueUnits) {
      const question = fullSceneQuestion(unit)
      expect(
        question.segments.map(({ speaker, text }) => ({
          speaker,
          text,
        })),
      ).toEqual(
        unit.transcript.map(({ speaker, text }) => ({
          speaker,
          text,
        })),
      )
      for (const segment of question.segments) {
        expect(segment.speaker).not.toBeNull()
        expect(segment.text).not.toContain(
          `${segment.speaker}:`,
        )
      }
    }
  })

  it('auto-continues A/B/A with stable distinct voices when two local voices exist', () => {
    const unit = releasedCatalogs().listening.units.find(
      (entry) => entry.activityType === 'listening-dialogue',
    )
    expect(unit).toBeDefined()
    const question = fullSceneQuestion(unit!)
    const speech = new RecordingSpeech(TWO_LOCAL_EN_US_VOICES)
    const controller = new ListeningPlaybackController({
      question,
      initialState: initialPlayback(question),
      speech,
    })

    controller.toggle()
    completeScene(speech, question.segments.length)

    expect(controller.snapshot.status).toBe('ended')
    expect(speech.requests.map(({ text }) => text)).toEqual(
      question.segments.map(({ text }) => text),
    )
    expect(
      question.segments.slice(0, 3).map(({ speaker }) => speaker),
    ).toEqual(['Maya', 'Leo', 'Maya'])
    expect(speech.requests[0].voiceId).toBe('qa-local-a')
    expect(speech.requests[1].voiceId).toBe('qa-local-b')
    expect(speech.requests[2].voiceId).toBe('qa-local-a')
    expect(
      question.segments.every(
        (segment) =>
          controller.snapshot.playCounts[segment.id] === 1,
      ),
    ).toBe(true)
  })

  it('uses one stable voice with a mild stable pitch/rate distinction when only one voice exists', () => {
    const unit = releasedCatalogs().listening.units.find(
      (entry) => entry.activityType === 'listening-dialogue',
    )
    expect(unit).toBeDefined()
    const question = fullSceneQuestion(unit!)
    const speech = new RecordingSpeech(ONE_LOCAL_EN_US_VOICE)
    const controller = new ListeningPlaybackController({
      question,
      initialState: initialPlayback(question),
      speech,
    })

    controller.toggle()
    completeScene(speech, question.segments.length)

    expect(
      new Set(speech.requests.map(({ voiceId }) => voiceId)),
    ).toEqual(new Set(['qa-local-a']))
    expect({
      voiceId: speech.requests[0].voiceId,
      pitch: speech.requests[0].pitch,
      rate: speech.requests[0].rate,
    }).toEqual({
      voiceId: speech.requests[2].voiceId,
      pitch: speech.requests[2].pitch,
      rate: speech.requests[2].rate,
    })
    expect([
      speech.requests[0].pitch,
      speech.requests[0].rate,
    ]).not.toEqual([
      speech.requests[1].pitch,
      speech.requests[1].rate,
    ])
    expect(
      Math.abs(
        (speech.requests[0].pitch ?? 1) -
          (speech.requests[1].pitch ?? 1),
      ),
    ).toBeLessThanOrEqual(0.12)
    expect(
      Math.abs(speech.requests[0].rate - speech.requests[1].rate),
    ).toBeLessThanOrEqual(0.05)
  })

  it('keeps a single narrator on one neutral stable profile', () => {
    const unit = releasedCatalogs().listening.units.find(
      (entry) =>
        entry.activityType !== 'listening-dialogue' &&
        new Set(entry.transcript.map(({ speaker }) => speaker))
          .size === 1,
    )
    expect(unit).toBeDefined()
    const question = fullSceneQuestion(unit!)
    const speech = new RecordingSpeech(TWO_LOCAL_EN_US_VOICES)
    const controller = new ListeningPlaybackController({
      question,
      initialState: initialPlayback(question),
      speech,
    })

    controller.toggle()
    completeScene(speech, question.segments.length)

    expect(
      new Set(
        speech.requests.map(({ voiceId, pitch, rate }) =>
          JSON.stringify({ voiceId, pitch, rate }),
        ),
      ).size,
    ).toBe(1)
    expect(speech.requests[0]).toMatchObject({
      voiceId: 'qa-local-a',
      pitch: 1,
      rate: 1,
    })
  })

  it('retains pause, resume, cancel, repeat-all and rate controls', () => {
    const unit = releasedCatalogs().listening.units.find(
      (entry) => entry.activityType === 'listening-dialogue',
    )
    expect(unit).toBeDefined()
    const question = fullSceneQuestion(unit!)
    const speech = new RecordingSpeech(TWO_LOCAL_EN_US_VOICES)
    const controller = new ListeningPlaybackController({
      question,
      initialState: initialPlayback(question),
      speech,
    })

    controller.toggle()
    controller.toggle()
    expect(controller.snapshot.status).toBe('paused')
    expect(speech.pauseCount).toBe(1)
    controller.toggle()
    expect(controller.snapshot.status).toBe('playing')
    expect(speech.resumeCount).toBe(1)

    controller.setRate(1.25)
    expect(controller.snapshot.status).toBe('idle')
    expect(speech.cancelCount).toBe(1)
    controller.setRepeatMode('all')
    controller.toggle()
    completeScene(speech, question.segments.length)
    expect(speech.requests.at(-1)).toMatchObject({
      text: question.segments[0].text,
      rate: 1.25,
    })

    controller.interrupt()
    expect(controller.snapshot.status).toBe('paused')
    expect(speech.cancelCount).toBe(2)
  })
})
