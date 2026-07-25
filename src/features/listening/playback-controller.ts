import { ListeningError } from './errors.ts'
import type {
  ListeningSpeechErrorCode,
  ListeningSpeechPort,
} from './speech-synthesis.ts'
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
  readonly onStateChange?: (state: ListeningPlaybackState) => void
  readonly onFailure?: (code: ListeningSpeechErrorCode) => void
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

function continuousText(segments: readonly ListeningSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
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
  private selectedSegmentOnly: boolean

  constructor(options: ListeningPlaybackControllerOptions) {
    validateState(options.question, options.initialState)
    this.question = options.question
    this.state = options.initialState
    this.speech = options.speech
    this.selectedSegmentOnly =
      options.question.playbackPolicy.sequenceMode !== 'all-segments' ||
      options.initialState.currentSegmentId !==
        options.question.primarySegmentId
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

  private playbackSegments(): readonly ListeningSegment[] {
    const playsCompleteScene =
      this.question.playbackPolicy.sequenceMode === 'all-segments' &&
      this.state.repeatMode !== 'segment' &&
      (!this.selectedSegmentOnly || this.state.repeatMode === 'all')
    return playsCompleteScene
      ? this.question.segments
      : [this.currentSegment()]
  }

  private stopQueue(nextStatus: 'idle' | 'paused'): void {
    this.generation += 1
    this.speech.cancel()
    this.update({
      status: nextStatus,
      errorMessage: null,
    })
  }

  private startPlayback(): void {
    if (
      this.state.status === 'unavailable' ||
      this.state.status === 'error'
    ) {
      return
    }
    const segments = this.playbackSegments()
    const token = ++this.generation
    let started = false
    try {
      this.update({
        status: 'playing',
        errorMessage: null,
      })
      this.speech.speak(
        {
          text: continuousText(segments),
          locale: 'en-US',
          rate: this.state.rate,
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
              playCounts: segments.reduce(
                (counts, segment) => ({
                  ...counts,
                  [segment.id]: (counts[segment.id] ?? 0) + 1,
                }),
                current.playCounts,
              ),
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
            if (
              this.state.repeatMode === 'segment' ||
              this.state.repeatMode === 'all'
            ) {
              this.startPlayback()
              return
            }
            this.update({ status: 'ended' })
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
    this.startPlayback()
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
    this.selectedSegmentOnly = true
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
    this.selectedSegmentOnly =
      question.playbackPolicy.sequenceMode !== 'all-segments' ||
      state.currentSegmentId !== question.primarySegmentId
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
