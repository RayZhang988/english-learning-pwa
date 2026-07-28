import type {
  EffectiveTimingPhaseDeclaration,
} from '../../platform/index.ts'
import type { ListeningSessionPhase } from './types.ts'

export type ListeningTimingPhaseDeclaration = Extract<
  EffectiveTimingPhaseDeclaration,
  {
    readonly phase:
      | 'answering'
      | 'audio-listening'
      | 'feedback'
      | 'loading'
      | 'paused'
  }
>

export interface ListeningEffectiveTimingSessionPort {
  start(declaration: ListeningTimingPhaseDeclaration): Promise<void>
  transition(declaration: ListeningTimingPhaseDeclaration): Promise<void>
  activity(): Promise<void>
  pause(): Promise<void>
  resume(declaration: ListeningTimingPhaseDeclaration): Promise<void>
  finish(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Task 01 owns the production session, clock, browser lifecycle, snapshots,
 * event IDs, and idle policy. Listening only declares real module phases.
 */
export interface ListeningEffectiveTimingSessionFactoryPort {
  create(
    taskId: string,
    expectedModuleId: 'listening',
  ): Promise<ListeningEffectiveTimingSessionPort>
}

type ActiveListeningPhase = Extract<
  ListeningSessionPhase,
  'answering' | 'feedback'
>

const CONTENT_LOADING: ListeningTimingPhaseDeclaration = {
  phase: 'loading',
  reason: 'content-loading',
}
const MEDIA_LOADING: ListeningTimingPhaseDeclaration = {
  phase: 'loading',
  reason: 'media-loading',
}
const AUDIO_LISTENING: ListeningTimingPhaseDeclaration = {
  phase: 'audio-listening',
  reason: 'active-audio-listening',
}
const ANSWERING: ListeningTimingPhaseDeclaration = {
  phase: 'answering',
  reason: 'active-answering',
}
const FEEDBACK: ListeningTimingPhaseDeclaration = {
  phase: 'feedback',
  reason: 'active-feedback',
}

function activeDeclaration(
  phase: ActiveListeningPhase,
): ListeningTimingPhaseDeclaration {
  return phase === 'answering' ? ANSWERING : FEEDBACK
}

type MediaState = 'inactive' | 'waiting' | 'active' | 'paused'

export class ListeningEffectiveTiming {
  readonly #taskId: string
  readonly #factory:
    | ListeningEffectiveTimingSessionFactoryPort
    | undefined
  #sessionPromise:
    | Promise<ListeningEffectiveTimingSessionPort>
    | null = null
  #started = false
  #disposeRetryRequired = false
  #mediaState: MediaState = 'inactive'
  #persistenceDepth = 0

  constructor(
    taskId: string,
    factory?: ListeningEffectiveTimingSessionFactoryPort,
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

  async beginMediaWait(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'waiting'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.transition(MEDIA_LOADING)
    }
  }

  async mediaStarted(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'active'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.resume(AUDIO_LISTENING)
    }
  }

  async mediaPaused(): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'paused'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.pause()
    }
  }

  async mediaEnded(phase: ActiveListeningPhase): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    this.#mediaState = 'inactive'
    await this.#ensureStarted(session)
    if (this.#persistenceDepth === 0) {
      await session.resume(activeDeclaration(phase))
    }
  }

  async mediaCanceled(): Promise<void> {
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
    phase: ActiveListeningPhase,
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
    phase: ActiveListeningPhase,
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
    if (this.#mediaState === 'active') {
      await session.resume(AUDIO_LISTENING)
      return
    }
    if (this.#mediaState === 'paused') {
      await session.pause()
      return
    }
    if (this.#mediaState === 'waiting') {
      await session.transition(MEDIA_LOADING)
      return
    }
    if (activatePhase) {
      await session.resume(activeDeclaration(phase))
    }
  }

  async synchronize(
    phase: ListeningSessionPhase,
    options: {
      readonly resume?: boolean
      readonly activateAnswering?: boolean
    } = {},
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
    if (this.#mediaState === 'active') {
      await session.resume(AUDIO_LISTENING)
      return
    }
    if (phase === 'answering' && !options.activateAnswering) {
      return
    }
    const declaration = activeDeclaration(phase)
    if (options.resume) {
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
    this.#mediaState = 'paused'
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
    session: ListeningEffectiveTimingSessionPort,
  ): Promise<void> {
    if (this.#started) {
      return
    }
    await session.start(CONTENT_LOADING)
    this.#started = true
  }

  async #getSession(): Promise<
    ListeningEffectiveTimingSessionPort | null
  > {
    if (!this.#factory) {
      return null
    }
    if (this.#sessionPromise) {
      return this.#sessionPromise
    }

    const creation = this.#factory.create(
      this.#taskId,
      'listening',
    )
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
