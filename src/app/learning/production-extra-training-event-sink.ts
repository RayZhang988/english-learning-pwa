import { AppError } from '../../core/index.ts'
import {
  applyExtraTrainingAttempt,
  applyGrowthTrainingCompleted,
  applyLearningEngineExtraTrainingEvent,
  createGrowthState,
  parseExtraTrainingEvent,
  type ExtraTrainingEvent,
  type ExtraTrainingSession,
  type LearningEngineRepository,
  type LearningEngineState,
} from '../../learning-engine/index.ts'
import type { ExtraTrainingEventSink } from '../../platform/index.ts'

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
  readonly #growthEvidenceEnabled: () => boolean

  constructor(
    engineStates: LearningEngineRepository,
    options: { readonly growthEvidenceEnabled?: () => boolean } = {},
  ) {
    this.#engineStates = engineStates
    this.#growthEvidenceEnabled = options.growthEvidenceEnabled ?? (() => true)
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

    const transition = applyLearningEngineExtraTrainingEvent({
      engineState,
      extraTraining: engineState.extraTraining,
      event,
    })
    let nextEngineState: LearningEngineState
    if (
      event.type ===
      'learning.extra-training.attempt.completed.v1'
    ) {
      const attempted = applyExtraTrainingAttempt(
        transition.engineState,
        event,
      ).state
      nextEngineState = {
        ...attempted,
        extraTraining: transition.extraTraining,
      }
    } else {
      nextEngineState = {
        ...transition.engineState,
        extraTraining: transition.extraTraining,
      }
    }
    // R6 is open-ended. A user exit is the explicit formal-session boundary;
    // it can be resumed later and a later exit becomes a distinct summary.
    // Unscorable-only, failed and provider/device paths have no scored record.
    if (
      event.type === 'learning.extra-training.exited.v1' &&
      this.#growthEvidenceEnabled()
    ) {
      const exited = nextEngineState.extraTraining?.sessions[session.sessionId]
      const score = exited?.score
      if (
        exited?.status === 'paused' &&
        exited.endReason === 'user-exited' &&
        score !== undefined &&
        score.correctCount + score.incorrectCount > 0
      ) {
        const growth = nextEngineState.growth ?? createGrowthState()
        const prefix = `extra:${exited.sessionId}:`
        const alreadyReported = growth.domains[exited.domain].sessions
          .filter((entry) => entry.source === 'extra-training' && entry.sessionId.startsWith(prefix))
          .reduce((total, entry) => ({ correct: total.correct + entry.correctCount, incorrect: total.incorrect + entry.incorrectCount }), { correct: 0, incorrect: 0 })
        const correctCount = score.correctCount - alreadyReported.correct
        const incorrectCount = score.incorrectCount - alreadyReported.incorrect
        if (correctCount + incorrectCount > 0) {
          nextEngineState = {
            ...nextEngineState,
            growth: applyGrowthTrainingCompleted(growth, {
              eventId: `growth:extra:${event.id}`,
              source: 'extra-training',
              sessionId: `${prefix}${event.id}`,
              domain: exited.domain,
              levelOrdinal: growth.domains[exited.domain].currentLevelOrdinal,
              correctCount,
              incorrectCount,
              localDate: exited.localDate,
              completedAt: event.occurredAt,
            }),
          }
        }
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
