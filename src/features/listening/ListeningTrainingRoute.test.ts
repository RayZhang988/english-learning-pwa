import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import type { WrongAnswerEvidence } from '../../learning-engine/index.ts'
import type { ListeningSupplyItem } from './types.ts'
import {
  hasListeningRuntimeRouteIdentityChanged,
  listeningRuntimeOptionsFromRouteProps,
  listeningRuntimeRouteIdentity,
  type ListeningTrainingRouteProps,
} from './ListeningTrainingRoute.tsx'
import { createListeningTask } from './test-fixtures.ts'

function props(
  overrides: Partial<ListeningTrainingRouteProps> = {},
): ListeningTrainingRouteProps {
  return {
    task: createListeningTask(),
    localDate: '2026-08-03',
    eventSink: new InMemoryPlatformEventSink(),
    onExit: () => undefined,
    ...overrides,
  }
}

const networkStatus = {
  current: () => 'online' as const,
  subscribe: () => () => undefined,
}

describe('ListeningTrainingRoute wrong-answer ports', () => {
  it('forwards the exact resolver and durable evidence sink to the daily runtime', () => {
    const resolver = (_item: ListeningSupplyItem) => ({
      reviewContentId: 'listening-review-content',
      originalQuestionType: 'listening-word-discrimination',
    })
    const sink = async (_evidence: WrongAnswerEvidence) => undefined

    const options = listeningRuntimeOptionsFromRouteProps(
      props({ reviewIdentityForItem: resolver, publishWrongAnswerEvidence: sink }),
      networkStatus,
    )

    expect(options.reviewIdentityForItem).toBe(resolver)
    expect(options.publishWrongAnswerEvidence).toBe(sink)
  })

  it('requires a fresh runtime when either wrong-answer port changes', () => {
    const resolverA = (_item: ListeningSupplyItem) => null
    const resolverB = (_item: ListeningSupplyItem) => null
    const sinkA = async (_evidence: WrongAnswerEvidence) => undefined
    const sinkB = async (_evidence: WrongAnswerEvidence) => undefined
    const current = listeningRuntimeRouteIdentity(props({
      reviewIdentityForItem: resolverA,
      publishWrongAnswerEvidence: sinkA,
    }))

    expect(hasListeningRuntimeRouteIdentityChanged(
      current,
      listeningRuntimeRouteIdentity(props({ reviewIdentityForItem: resolverB, publishWrongAnswerEvidence: sinkA })),
    )).toBe(true)
    expect(hasListeningRuntimeRouteIdentityChanged(
      current,
      listeningRuntimeRouteIdentity(props({ reviewIdentityForItem: resolverA, publishWrongAnswerEvidence: sinkB })),
    )).toBe(true)
  })

  it('keeps the prior runtime identity when both optional ports are absent', () => {
    const current = listeningRuntimeRouteIdentity(props())
    const next = listeningRuntimeRouteIdentity(props())

    expect(hasListeningRuntimeRouteIdentityChanged(current, next)).toBe(false)
    expect(listeningRuntimeOptionsFromRouteProps(props(), networkStatus)).toMatchObject({
      reviewIdentityForItem: undefined,
      publishWrongAnswerEvidence: undefined,
    })
  })
})
