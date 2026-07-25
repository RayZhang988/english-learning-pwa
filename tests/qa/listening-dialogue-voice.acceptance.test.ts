import { describe, expect, it } from 'vitest'
import {
  ListeningPlaybackController,
  type ListeningPlaybackRate,
  type ListeningPlaybackState,
  type ListeningQuestion,
  type ListeningSpeechCallbacks,
  type ListeningSpeechCapabilities,
  type ListeningSpeechPort,
  type ListeningSpeechRequest,
  type ListeningTrainingUnit,
} from '../../src/features/listening/index.ts'
import { releasedCatalogs } from './fixtures/production-course.ts'

class RecordingSpeech implements ListeningSpeechPort {
  readonly requests: ListeningSpeechRequest[] = []
  pauseCount = 0
  resumeCount = 0
  cancelCount = 0
  private activeCallbacks: ListeningSpeechCallbacks | null = null
  private paused = false
  private speaking = false

  capabilities(): ListeningSpeechCapabilities {
    return {
      supported: true,
      voicesKnown: true,
      enUsVoiceAvailable: true,
      localEnUsVoiceCount: 2,
      pauseResumeAvailable: true,
      supportedRates: [0.75, 1, 1.25],
    }
  }

  voices() {
    return [
      { id: 'diagnostic-a', locale: 'en-US', localService: true },
      { id: 'diagnostic-b', locale: 'en-US', localService: true },
    ] as const
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

function firstDialogueQuestion(): ListeningQuestion {
  const unit = releasedCatalogs().listening.units.find(
    (entry) => entry.activityType === 'listening-dialogue',
  )
  if (!unit) {
    throw new Error('The released course has no listening dialogue.')
  }
  return fullSceneQuestion(unit)
}

function continuousText(question: ListeningQuestion): string {
  return question.segments
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
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

function createController(
  question = firstDialogueQuestion(),
): {
  readonly controller: ListeningPlaybackController
  readonly speech: RecordingSpeech
} {
  const speech = new RecordingSpeech()
  return {
    speech,
    controller: new ListeningPlaybackController({
      question,
      initialState: initialPlayback(question),
      speech,
    }),
  }
}

describe('released listening continuous speech acceptance', () => {
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
        expect(segment.text).not.toContain(`${segment.speaker}:`)
      }
    }
  })

  it('submits a full dialogue as one ordered neutral request', () => {
    const question = firstDialogueQuestion()
    const { controller, speech } = createController(question)

    controller.toggle()

    expect(speech.requests).toEqual([
      {
        text: continuousText(question),
        locale: 'en-US',
        rate: 1,
      },
    ])
    expect(speech.requests[0]).not.toHaveProperty('voiceId')
    expect(speech.requests[0]).not.toHaveProperty('pitch')
    expect(speech.requests[0].text).not.toMatch(
      /(?:Maya|Leo|Staff):/u,
    )

    speech.completeCurrent()
    expect(controller.snapshot.status).toBe('ended')
    expect(
      question.segments.every(
        (segment) =>
          controller.snapshot.playCounts[segment.id] === 1,
      ),
    ).toBe(true)
  })

  it.each([0.75, 1, 1.25] as const)(
    'keeps the exact user-selected %s rate',
    (rate: ListeningPlaybackRate) => {
      const question = firstDialogueQuestion()
      const { controller, speech } = createController(question)

      controller.setRate(rate)
      controller.toggle()

      expect(speech.requests).toEqual([
        {
          text: continuousText(question),
          locale: 'en-US',
          rate,
        },
      ])
    },
  )

  it('reads only the explicitly selected sentence body', () => {
    const question = firstDialogueQuestion()
    const selected = question.segments[1]
    const { controller, speech } = createController(question)

    controller.selectSegment(selected.id)
    controller.toggle()

    expect(speech.requests).toEqual([
      {
        text: selected.text,
        locale: 'en-US',
        rate: 1,
      },
    ])
    expect(speech.requests[0].text).not.toContain(
      `${selected.speaker}:`,
    )
  })

  it('repeats the current sentence and loops the complete dialogue at their real scopes', () => {
    const question = firstDialogueQuestion()
    const selected = question.segments[1]
    const segmentRun = createController(question)

    segmentRun.controller.selectSegment(selected.id)
    segmentRun.controller.setRepeatMode('segment')
    segmentRun.controller.toggle()
    segmentRun.speech.completeCurrent()
    expect(
      segmentRun.speech.requests.map(({ text }) => text),
    ).toEqual([selected.text, selected.text])
    segmentRun.controller.interrupt()

    const allRun = createController(question)
    allRun.controller.setRepeatMode('all')
    allRun.controller.toggle()
    allRun.speech.completeCurrent()
    expect(allRun.speech.requests.map(({ text }) => text)).toEqual([
      continuousText(question),
      continuousText(question),
    ])
    allRun.controller.interrupt()
  })

  it('retains pause, resume, cancel and rate-change controls', () => {
    const { controller, speech } = createController()

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
    controller.toggle()
    expect(speech.requests.at(-1)?.rate).toBe(1.25)

    controller.interrupt()
    expect(controller.snapshot.status).toBe('paused')
    expect(speech.cancelCount).toBe(2)
  })
})
