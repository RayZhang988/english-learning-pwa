import { ListeningError } from './errors.ts'
import type {
  ListeningSpeechErrorCode,
  ListeningSpeechPort,
} from './speech-synthesis.ts'
import {
  ListeningSpeakerVoiceProfiles,
  type ListeningSpeakerVoiceProfile,
} from './speaker-voice-profiles.ts'
import type {
  ListeningPlaybackRate,
  ListeningPlaybackState,
  ListeningQuestion,
  ListeningRepeatMode,
  ListeningSegment,
} from './types.ts'

export interface ListeningPlaybackControllerOptions {
  readonly question: ListeningQuestion
  readonly initialState: ListeningPlaybackState
  readonly speech: ListeningSpeechPort
  readonly speakerVoiceProfiles?: ListeningSpeakerVoiceProfiles
  readonly onStateChange?: (state: ListeningPlaybackState) => void
  readonly onFailure?: (code: ListeningSpeechErrorCode) => void
}

function effectiveRate(
  rate: ListeningPlaybackRate,
  rateScale: number,
  allowedRates: readonly ListeningPlaybackRate[],
): number {
  const lowerBound = Math.min(...allowedRates)
  const upperBound = Math.max(...allowedRates)
  const scaled = rate * rateScale
  return Math.round(
    Math.min(upperBound, Math.max(lowerBound, scaled)) * 1_000,
  ) / 1_000
}

function validateState(
  question: ListeningQuestion,
  state: ListeningPlaybackState,
): void {
  if (
    !question.segments.some(
      (segment) => segment.id === state.currentSegmentId,
    ) ||
    !question.playbackPolicy.allowedRates.includes(state.rate) ||
    (!question.playbackPolicy.allowRepeat &&
      state.repeatMode !== 'none')
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'Initial playback state violates the question policy.',
    )
  }
}

function profileSpeakers(
  question: ListeningQuestion,
): readonly (string | null)[] {
  if (
    question.playbackPolicy.sequenceMode === 'all-segments' ||
    question.playbackPolicy.allowSegmentSelection
  ) {
    return question.segments.map((segment) => segment.speaker)
  }
  return question.segments
    .filter((segment) => segment.id === question.primarySegmentId)
    .map((segment) => segment.speaker)
}

export class ListeningPlaybackController {
  private question: ListeningQuestion
  private state: ListeningPlaybackState
  private readonly speech: ListeningSpeechPort
  private readonly onStateChange?: (
    state: ListeningPlaybackState,
  ) => void
  private readonly onFailure?: (code: ListeningSpeechErrorCode) => void
  private generation = 0
  private speakerVoiceProfiles: ListeningSpeakerVoiceProfiles
  private readonly ownsSpeakerVoiceProfiles: boolean

  constructor(options: ListeningPlaybackControllerOptions) {
    validateState(options.question, options.initialState)
    this.question = options.question
    this.state = options.initialState
    this.speech = options.speech
    this.ownsSpeakerVoiceProfiles = !options.speakerVoiceProfiles
    this.speakerVoiceProfiles =
      options.speakerVoiceProfiles ??
      new ListeningSpeakerVoiceProfiles(
        profileSpeakers(options.question),
        () => this.speech.voices(),
      )
    this.onStateChange = options.onStateChange
    this.onFailure = options.onFailure
    if (!this.speech.capabilities().supported) {
      this.state = {
        ...this.state,
        status: 'unavailable',
        errorMessage: '当前浏览器无法使用设备合成语音。',
      }
    }
  }

  get snapshot(): ListeningPlaybackState {
    return this.state
  }

  private update(
    patch:
      | Partial<ListeningPlaybackState>
      | ((
          current: ListeningPlaybackState,
        ) => ListeningPlaybackState),
  ): ListeningPlaybackState {
    this.state =
      typeof patch === 'function'
        ? patch(this.state)
        : { ...this.state, ...patch }
    this.onStateChange?.(this.state)
    return this.state
  }

  private currentSegment(): ListeningSegment {
    const segment = this.question.segments.find(
      (entry) => entry.id === this.state.currentSegmentId,
    )
    if (!segment) {
      throw new ListeningError(
        'content-reference-missing',
        `Unknown listening segment ${this.state.currentSegmentId}.`,
      )
    }
    return segment
  }

  private voiceProfile(
    segment: ListeningSegment,
  ): ListeningSpeakerVoiceProfile {
    return this.speakerVoiceProfiles.profileFor(segment.speaker)
  }

  private stopQueue(nextStatus: 'idle' | 'paused'): void {
    this.generation += 1
    this.speech.cancel()
    this.update({
      status: nextStatus,
      errorMessage: null,
    })
  }

  private startCurrent(): void {
    if (
      this.state.status === 'unavailable' ||
      this.state.status === 'error'
    ) {
      return
    }
    const segment = this.currentSegment()
    const voiceProfile = this.voiceProfile(segment)
    const token = ++this.generation
    let started = false
    try {
      this.update({
        status: 'playing',
        errorMessage: null,
      })
      this.speech.speak(
        {
          text: segment.text,
          locale: segment.locale,
          rate: effectiveRate(
            this.state.rate,
            voiceProfile.rateScale,
            this.question.playbackPolicy.allowedRates,
          ),
          pitch: voiceProfile.pitch,
          voiceId: voiceProfile.voiceId,
        },
        {
          onStart: () => {
            if (token !== this.generation || started) {
              return
            }
            started = true
            this.update((current) => ({
              ...current,
              status: 'playing',
              errorMessage: null,
              playCounts: {
                ...current.playCounts,
                [segment.id]:
                  (current.playCounts[segment.id] ?? 0) + 1,
              },
            }))
          },
          onPause: () => {
            if (token === this.generation) {
              this.update({ status: 'paused' })
            }
          },
          onResume: () => {
            if (token === this.generation) {
              this.update({ status: 'playing' })
            }
          },
          onEnd: () => {
            if (token !== this.generation) {
              return
            }
            this.continueQueue()
          },
          onError: (code) => {
            if (token !== this.generation) {
              return
            }
            this.update({
              status: 'error',
              errorMessage: `设备语音播放失败：${code}`,
            })
            this.onFailure?.(code)
          },
        },
      )
    } catch (error) {
      if (token !== this.generation) {
        return
      }
      const message =
        error instanceof Error
          ? error.message
          : '设备语音播放失败。'
      this.update({ status: 'error', errorMessage: message })
      this.onFailure?.('synthesis-failed')
    }
  }

  private continueQueue(): void {
    if (this.state.repeatMode === 'segment') {
      this.startCurrent()
      return
    }
    const index = this.question.segments.findIndex(
      (segment) => segment.id === this.state.currentSegmentId,
    )
    const sequenceContinues =
      this.question.playbackPolicy.sequenceMode === 'all-segments' &&
      index + 1 < this.question.segments.length
    const repeatsAll = this.state.repeatMode === 'all'
    if (sequenceContinues || repeatsAll) {
      const next =
        this.question.segments[
          sequenceContinues ? index + 1 : 0
        ]
      this.update({ currentSegmentId: next.id })
      this.startCurrent()
      return
    }
    this.update({ status: 'ended' })
  }

  toggle(): ListeningPlaybackState {
    if (
      this.state.status === 'unavailable' ||
      this.state.status === 'error'
    ) {
      return this.state
    }
    if (this.state.status === 'playing') {
      this.speech.pause()
      this.update({ status: 'paused' })
      return this.state
    }
    if (this.state.status === 'paused' && this.speech.isPaused()) {
      this.speech.resume()
      this.update({ status: 'playing' })
      return this.state
    }
    this.startCurrent()
    return this.state
  }

  setRate(rate: number): ListeningPlaybackState {
    if (
      !this.question.playbackPolicy.allowedRates.includes(
        rate as ListeningPlaybackRate,
      )
    ) {
      throw new ListeningError(
        'session-transition-invalid',
        `Playback rate ${rate} is not allowed for this question.`,
      )
    }
    if (this.state.status === 'playing' || this.state.status === 'paused') {
      this.stopQueue('idle')
    }
    return this.update({ rate: rate as ListeningPlaybackRate })
  }

  selectSegment(segmentId: string): ListeningPlaybackState {
    if (
      segmentId !== this.state.currentSegmentId &&
      !this.question.playbackPolicy.allowSegmentSelection
    ) {
      throw new ListeningError(
        'session-transition-invalid',
        'Segment selection is disabled for this question.',
      )
    }
    if (
      !this.question.segments.some(
        (segment) => segment.id === segmentId,
      )
    ) {
      throw new ListeningError(
        'content-reference-missing',
        `Unknown listening segment ${segmentId}.`,
      )
    }
    if (this.state.status === 'playing' || this.state.status === 'paused') {
      this.stopQueue('idle')
    }
    return this.update({
      currentSegmentId: segmentId,
      status: 'idle',
      errorMessage: null,
    })
  }

  setRepeatMode(mode: ListeningRepeatMode): ListeningPlaybackState {
    if (!this.question.playbackPolicy.allowRepeat && mode !== 'none') {
      throw new ListeningError(
        'session-transition-invalid',
        'Repeat is disabled for this question.',
      )
    }
    return this.update({ repeatMode: mode })
  }

  interrupt(): ListeningPlaybackState {
    if (this.state.status === 'playing' || this.state.status === 'paused') {
      this.stopQueue('paused')
    }
    return this.state
  }

  replace(
    question: ListeningQuestion,
    state: ListeningPlaybackState,
  ): ListeningPlaybackState {
    validateState(question, state)
    this.generation += 1
    this.speech.cancel()
    this.question = question
    this.state = state
    if (this.ownsSpeakerVoiceProfiles) {
      this.speakerVoiceProfiles = new ListeningSpeakerVoiceProfiles(
        profileSpeakers(question),
        () => this.speech.voices(),
      )
    }
    if (!this.speech.capabilities().supported) {
      this.state = {
        ...state,
        status: 'unavailable',
        errorMessage: '当前浏览器无法使用设备合成语音。',
      }
    }
    this.onStateChange?.(this.state)
    return this.state
  }

  dispose(): void {
    this.generation += 1
    this.speech.cancel()
  }
}
