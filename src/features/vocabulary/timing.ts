import type {
  EffectiveTimingPhaseDeclaration,
} from '../../platform/index.ts'
import type { VocabularySessionPhase } from './types.ts'

export type VocabularyTimingPhaseDeclaration = Extract<
  EffectiveTimingPhaseDeclaration,
  {
    readonly phase: 'answering' | 'feedback' | 'loading' | 'paused'
  }
>

export interface VocabularyEffectiveTimingSessionPort {
  start(declaration: VocabularyTimingPhaseDeclaration): Promise<void>
  transition(declaration: VocabularyTimingPhaseDeclaration): Promise<void>
  activity(): Promise<void>
  pause(): Promise<void>
  resume(declaration: VocabularyTimingPhaseDeclaration): Promise<void>
  finish(): Promise<void>
  dispose(): Promise<void>
}

/**
 * The 01 route host owns production session creation. Vocabulary only asks
 * for its real task ID and declares module phases through this narrow port.
 */
export interface VocabularyEffectiveTimingSessionFactoryPort {
  create(
    taskId: string,
    expectedModuleId: 'vocabulary',
  ): Promise<VocabularyEffectiveTimingSessionPort>
}

const LOADING: VocabularyTimingPhaseDeclaration = {
  phase: 'loading',
  reason: 'content-loading',
}
const ANSWERING: VocabularyTimingPhaseDeclaration = {
  phase: 'answering',
  reason: 'active-answering',
}
const FEEDBACK: VocabularyTimingPhaseDeclaration = {
  phase: 'feedback',
  reason: 'active-feedback',
}

function activeDeclaration(
  phase: Extract<VocabularySessionPhase, 'answering' | 'feedback'>,
): VocabularyTimingPhaseDeclaration {
  return phase === 'answering' ? ANSWERING : FEEDBACK
}

export class VocabularyEffectiveTiming {
  readonly #taskId: string
  readonly #factory:
    | VocabularyEffectiveTimingSessionFactoryPort
    | undefined
  #sessionPromise:
    | Promise<VocabularyEffectiveTimingSessionPort>
    | null = null
  #started = false
  #disposeRetryRequired = false

  constructor(
    taskId: string,
    factory?: VocabularyEffectiveTimingSessionFactoryPort,
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
    if (!this.#started) {
      await session.start(LOADING)
      this.#started = true
      return
    }
    await session.transition(LOADING)
  }

  async beginPersistenceWait(
    recordActivity: boolean,
  ): Promise<void> {
    const session = await this.#getSession()
    if (!session) {
      return
    }
    if (!this.#started) {
      await session.start(LOADING)
      this.#started = true
    }
    if (recordActivity) {
      await session.activity()
    }
    await session.transition(LOADING)
  }

  async synchronize(
    phase: VocabularySessionPhase,
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
    if (!this.#started) {
      await session.start(LOADING)
      this.#started = true
    }
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
      }
    }
  }

  async #getSession(): Promise<VocabularyEffectiveTimingSessionPort | null> {
    if (!this.#factory) {
      return null
    }
    if (this.#sessionPromise) {
      return this.#sessionPromise
    }

    const creation = this.#factory.create(
      this.#taskId,
      'vocabulary',
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
