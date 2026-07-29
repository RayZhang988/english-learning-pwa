import { AppError } from '../../core/index.ts'
import {
  applyExtraTrainingAttempt,
  applyExtraTrainingEvent,
  parseExtraTrainingEvent,
  type ExtraTrainingEvent,
  type ExtraTrainingSession,
  type LearningEngineRepository,
  type LearningEngineState,
} from '../../learning-engine/index.ts'
import type { ExtraTrainingEventSink } from '../../platform/index.ts'

const MAX_PROCESSED_EVENT_IDS = 2_000

export interface ExtraTrainingEngineUpdate {
  readonly engineState: LearningEngineState
  readonly session: ExtraTrainingSession
}

export type ExtraTrainingEngineUpdateListener = (
  update: ExtraTrainingEngineUpdate,
) => void

function assertSessionIdentity(
  session: ExtraTrainingSession,
  event: ExtraTrainingEvent,
): void {
  if (
    event.payload.sessionId !== session.sessionId ||
    event.payload.localDate !== session.localDate ||
    event.payload.domain !== session.domain ||
    event.payload.targetModuleId !== session.targetModuleId ||
    event.payload.mode !== session.mode
  ) {
    throw new TypeError(
      'Extra-training event identity does not match its session.',
    )
  }
}

function appendProcessedEvent(
  state: LearningEngineState,
  eventId: string,
): LearningEngineState {
  const extraTraining = state.extraTraining
  if (!extraTraining) {
    throw new TypeError('Extra-training state is not initialized.')
  }
  if (extraTraining.processedEventIds.includes(eventId)) {
    return state
  }
  return {
    ...state,
    extraTraining: {
      ...extraTraining,
      processedEventIds: [
        ...extraTraining.processedEventIds,
        eventId,
      ].slice(-MAX_PROCESSED_EVENT_IDS),
    },
  }
}

/**
 * Dedicated R6 persistence boundary.
 *
 * This class deliberately does not implement PlatformEventSink and never
 * calls applyPlanEvent. One engine-state write atomically persists both the
 * independent session ledger and any accepted mastery evidence.
 */
export class ProductionExtraTrainingEventSink
  implements ExtraTrainingEventSink
{
  readonly #engineStates: LearningEngineRepository
  readonly #listeners =
    new Set<ExtraTrainingEngineUpdateListener>()
  #queue: Promise<void> = Promise.resolve()

  constructor(engineStates: LearningEngineRepository) {
    this.#engineStates = engineStates
  }

  subscribe(
    listener: ExtraTrainingEngineUpdateListener,
  ): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  publishExtraTrainingEvent(
    event: ExtraTrainingEvent,
  ): Promise<void> {
    const operation = this.#queue.then(() => this.#process(event))
    this.#queue = operation.catch(() => undefined)
    return operation
  }

  async #process(platformEvent: ExtraTrainingEvent): Promise<void> {
    const event = parseExtraTrainingEvent(platformEvent)
    const engineState = await this.#engineStates.load()
    if (!engineState?.extraTraining) {
      throw new AppError(
        'unknown',
        '额外训练状态尚未初始化，事件没有被保存。',
        { recoverable: true },
      )
    }
    if (
      engineState.extraTraining.processedEventIds.includes(event.id)
    ) {
      return
    }
    const session =
      engineState.extraTraining.sessions[event.payload.sessionId]
    if (!session) {
      throw new TypeError(
        'Extra-training event session does not exist.',
      )
    }
    assertSessionIdentity(session, event)

    let nextEngineState: LearningEngineState
    if (
      event.type ===
      'learning.extra-training.attempt.completed.v1'
    ) {
      nextEngineState = appendProcessedEvent(
        applyExtraTrainingAttempt(engineState, event).state,
        event.id,
      )
    } else {
      nextEngineState = {
        ...engineState,
        extraTraining: applyExtraTrainingEvent(
          engineState.extraTraining,
          event,
        ),
      }
    }
    await this.#engineStates.save(nextEngineState)
    const nextSession =
      nextEngineState.extraTraining?.sessions[session.sessionId]
    if (!nextSession) {
      throw new TypeError(
        'Saved extra-training state lost its session.',
      )
    }
    for (const listener of this.#listeners) {
      listener({
        engineState: nextEngineState,
        session: nextSession,
      })
    }
  }
}
