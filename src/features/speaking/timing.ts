import type {
  EffectiveTimingPhaseDeclaration,
} from '../../platform/index.ts'
import type { SpeakingSessionPhase } from './types.ts'

export type SpeakingTimingPhaseDeclaration = Extract<
  EffectiveTimingPhaseDeclaration,
  {
    readonly phase:
      | 'answering'
      | 'recording'
      | 'playback'
      | 'feedback'
      | 'loading'
      | 'permission-wait'
      | 'network-wait'
      | 'paused'
  }
>

export interface SpeakingEffectiveTimingSessionPort {
  start(declaration: SpeakingTimingPhaseDeclaration): Promise<void>
  transition(declaration: SpeakingTimingPhaseDeclaration): Promise<void>
  activity(): Promise<void>
  pause(): Promise<void>
  resume(declaration: SpeakingTimingPhaseDeclaration): Promise<void>
  finish(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Task 01 owns the production clock, browser lifecycle, idle cutoff,
 * snapshots, event IDs, and event persistence. Speaking only declares
 * phases that are proven by its runtime or real media callbacks.
 */
export interface SpeakingEffectiveTimingSessionFactoryPort {
  create(
    taskId: string,
    expectedModuleId: 'speaking',
  ): Promise<SpeakingEffectiveTimingSessionPort>
}

type ActiveSpeakingPhase = Extract<
  SpeakingSessionPhase,
  'practicing' | 'feedback'
>

const CONTENT_LOADING: SpeakingTimingPhaseDeclaration = {
  phase: 'loading',
  reason: 'content-loading',
}
const MEDIA_LOADING: SpeakingTimingPhaseDeclaration = {
  phase: 'loading',
  reason: 'media-loading',
}
const ANSWERING: SpeakingTimingPhaseDeclaration = {
  phase: 'answering',
  reason: 'active-answering',
}
const RECORDING: SpeakingTimingPhaseDeclaration = {
  phase: 'recording',
  reason: 'active-recording',
}
const PLAYBACK: SpeakingTimingPhaseDeclaration = {
  phase: 'playback',
  reason: 'active-playback',
}
const FEEDBACK: SpeakingTimingPhaseDeclaration = {
  phase: 'feedback',
  reason: 'active-feedback',
}
const PERMISSION_WAIT: SpeakingTimingPhaseDeclaration = {
  phase: 'permission-wait',
  reason: 'permission-wait',
}
const NETWORK_WAIT: SpeakingTimingPhaseDeclaration = {
  phase: 'network-wait',
  reason: 'network-wait',
}

function activeDeclaration(
  phase: ActiveSpeakingPhase,
): SpeakingTimingPhaseDeclaration {
  return phase === 'practicing' ? ANSWERING : FEEDBACK
}

type SpeakingMediaState =
  | 'inactive'
  | 'recording-wait'
  | 'recording'
  | 'recording-paused'
  | 'playback-wait'
  | 'playback'
  | 'playback-paused'

export class SpeakingEffectiveTiming {
  readonly #taskId: string
  readonly #factory:
    | SpeakingEffectiveTimingSessionFactoryPort
    | undefined
  #sessionPromise:
    | Promise<SpeakingEffectiveTimingSessionPort>
    | null = null
  #started = false
  #disposeRetryRequired = false
  #mediaState: SpeakingMediaState = 'inactive'
  #persistenceDepth = 0

  constructor(
    taskId: string,
    factory?: SpeakingEffectiveTimingSessionFactoryPort,
  ) {
    this.#taskId = taskId
    this.#factory = factory
  }

  get enabled(): boolean {
    return this.#factory !== undefined
  }

  async startLoading(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'inactive'
    if (!this.#started) {
      await session.start(CONTENT_LOADING)
      this.#started = true
      return
    }
    await session.transition(CONTENT_LOADING)
  }

  async beginPermissionWait(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'inactive'
    await this.#ensureStarted(session)
    await session.resume(ANSWERING)
    await session.activity()
    await session.transition(PERMISSION_WAIT)
  }

  async beginRecordingWait(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'recording-wait'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.transition(MEDIA_LOADING)
    }
  }

  async recordingStarted(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'recording'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.resume(RECORDING)
    }
  }

  async recordingPaused(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'recording-paused'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.pause()
    }
  }

  async recordingResumed(): Promise<void> {
    return this.recordingStarted()
  }

  async recordingStopped(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'inactive'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.transition(MEDIA_LOADING)
    }
  }

  async beginRecognitionWait(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'inactive'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.transition(NETWORK_WAIT)
    }
  }

  async beginPlaybackWait(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'playback-wait'
    await this.#ensureStarted(session)
    await session.resume(FEEDBACK)
    await session.activity()
    if (this.#persistenceDepth === 0) {
      await session.transition(MEDIA_LOADING)
    }
  }

  async playbackStarted(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'playback'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.resume(PLAYBACK)
    }
  }

  async playbackWaiting(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'playback-wait'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.transition(MEDIA_LOADING)
    }
  }

  async playbackPaused(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'playback-paused'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.pause()
    }
  }

  async playbackEnded(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'inactive'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.transition(MEDIA_LOADING)
    }
  }

  async beginPersistenceWait(
    phase: ActiveSpeakingPhase,
    recordActivity: boolean,
  ): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#persistenceDepth += 1
    await this.#ensureStarted(session)
    if (recordActivity) {
      await session.resume(activeDeclaration(phase))
      await session.activity()
    }
    await session.transition(CONTENT_LOADING)
  }

  async endPersistenceWait(
    phase: ActiveSpeakingPhase,
    activatePhase: boolean,
  ): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#persistenceDepth = Math.max(0, this.#persistenceDepth - 1)
    if (this.#persistenceDepth > 0) {
      return
    }
    if (this.#mediaState === 'recording') {
      await session.resume(RECORDING)
      return
    }
    if (this.#mediaState === 'playback') {
      await session.resume(PLAYBACK)
      return
    }
    if (
      this.#mediaState === 'recording-paused' ||
      this.#mediaState === 'playback-paused'
    ) {
      await session.pause()
      return
    }
    if (
      this.#mediaState === 'recording-wait' ||
      this.#mediaState === 'playback-wait'
    ) {
      await session.transition(MEDIA_LOADING)
      return
    }
    if (activatePhase) {
      await session.resume(activeDeclaration(phase))
    }
  }

  async synchronize(
    phase: SpeakingSessionPhase,
    resume = false,
  ): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    if (phase === 'completed') {
      await session.finish()
      return
    }
    if (phase === 'error') {
      await this.startLoading()
      return
    }
    if (phase === 'paused') {
      await session.pause()
      return
    }
    const declaration = activeDeclaration(phase)
    if (resume) {
      await session.resume(declaration)
      return
    }
    await session.transition(declaration)
  }

  async pause(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState =
      this.#mediaState === 'recording'
        ? 'recording-paused'
        : this.#mediaState === 'playback'
          ? 'playback-paused'
          : 'inactive'
    await this.#ensureStarted(session)
    await session.pause()
  }

  async finish(): Promise<void> {
    const session = await this.#getSession()
    await session?.finish()
  }

  async dispose(): Promise<void> {
    let current = this.#sessionPromise
    if (!current && this.#disposeRetryRequired) {
      const restored = this.#getSession()
      current = restored.then((session) => {
        if (!session) {
          throw new TypeError(
            'A timing factory must restore a session before disposal retry.',
          )
        }
        return session
      })
      this.#sessionPromise = current
    }
    if (!current) {
      return
    }
    try {
      const session = await current
      await session.dispose()
      this.#disposeRetryRequired = false
    } catch (error) {
      this.#disposeRetryRequired = true
      throw error
    } finally {
      if (this.#sessionPromise === current) {
        this.#sessionPromise = null
        this.#started = false
        this.#mediaState = 'inactive'
        this.#persistenceDepth = 0
      }
    }
  }

  async #ensureStarted(
    session: SpeakingEffectiveTimingSessionPort,
  ): Promise<void> {
    if (this.#started) {
      return
    }
    await session.start(CONTENT_LOADING)
    this.#started = true
  }

  async #getSession(): Promise<
    SpeakingEffectiveTimingSessionPort | null
  > {
    if (!this.#factory) {
      return null
    }
    if (this.#sessionPromise) {
      return this.#sessionPromise
    }
    const creation = this.#factory.create(this.#taskId, 'speaking')
    this.#sessionPromise = creation
    try {
      return await creation
    } catch (error) {
      if (this.#sessionPromise === creation) {
        this.#sessionPromise = null
      }
      throw error
    }
  }
}
