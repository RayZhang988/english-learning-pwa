import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import {
  createTrainingSupplyRound,
  type WrongAnswerEvidence,
} from '../../learning-engine/index.ts'
import type { NamespaceStore, StoredRecord } from '../../storage/index.ts'
import { ListeningSessionRepository } from './repository.ts'
import type { ListeningSupplyProvider } from './supply.ts'
import type { ListeningSpeechPort } from './speech-synthesis.ts'
import {
  choiceQuestion,
  createListeningUnit,
  dictationQuestion,
  createListeningTask,
} from './test-fixtures.ts'
import type { ListeningCatalog, ListeningSupplyItem } from './types.ts'
import {
  createListeningTrainingRouteRuntime,
  hasListeningRuntimeRouteIdentityChanged,
  listeningRuntimeOptionsFromRouteProps,
  listeningRuntimeRouteIdentity,
  sameListeningSupplyRound,
  type ListeningTrainingRouteProps,
} from './ListeningTrainingRoute.tsx'

class MemoryStore implements NamespaceStore {
  private readonly records = new Map<string, StoredRecord<unknown>>()

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> {
    this.records.set(key, {
      namespace: 'feature.listening', key, value, schemaVersion,
      updatedAt: '2026-08-11T00:00:00.000Z',
    })
  }

  async delete(key: string): Promise<void> { this.records.delete(key) }
  async keys(): Promise<readonly string[]> { return [...this.records.keys()] }
  async clear(): Promise<void> { this.records.clear() }
}

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

describe('ListeningTrainingRoute R11 runtime identity', () => {
  it('keeps runtime identity for a cloned persisted supply round', () => {
    const round = createTrainingSupplyRound({
      seed: 'same-round',
      candidateItemIds: ['listening-a', 'listening-b'],
      shortTermExcludedItemIds: [],
    })

    expect(
      sameListeningSupplyRound(round, { ...round, order: [...round.order] }),
    ).toBe(true)
    expect(sameListeningSupplyRound(round, { ...round, seed: 'new-round' })).toBe(false)
  })
})

const availableSpeech: ListeningSpeechPort = {
  capabilities: () => ({
    supported: true, voicesKnown: true, enUsVoiceAvailable: true,
    localEnUsVoiceCount: 1, pauseResumeAvailable: true,
    supportedRates: [0.75, 1, 1.25],
  }),
  voices: () => [{ id: 'test-en-us', locale: 'en-US', localService: true }],
  speak: (_request, callbacks) => callbacks.onStart?.(),
  pause: () => undefined,
  resume: () => undefined,
  cancel: () => undefined,
  isPaused: () => false,
  isSpeaking: () => false,
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

  it('forwards a supplied round through choice and dictation sessions without losing R9/R10 data on refresh', async () => {
    const unit = createListeningUnit([choiceQuestion, dictationQuestion])
    const catalog: ListeningCatalog = {
      schemaVersion: 1,
      packageVersion: '1.0.0',
      extensionVersion: '1.2.0',
      courseId: 'survival-travel-american-4w',
      units: [unit],
      getUnit: (contentRef) => contentRef === unit.contentRef ? unit : undefined,
    }
    const items: readonly ListeningSupplyItem[] = [
      {
        itemId: 'route-choice', learningUnitId: unit.learningUnitId,
        contentRef: unit.contentRef, difficultyLevel: 2, tags: unit.tags,
        knowledgePointId: 'knowledge-v1-listening-00000001',
        semanticCategoryId: 'semantic-v1:greeting-introduction',
        playbackContentId: 'listening-playback-v1-00000001',
        source: { sourceType: 'listening-extension', sourceId: choiceQuestion.id, variantId: 'word-discrimination' },
      },
      {
        itemId: 'route-dictation', learningUnitId: unit.learningUnitId,
        contentRef: unit.contentRef, difficultyLevel: 2, tags: unit.tags,
        knowledgePointId: 'knowledge-v1-listening-00000002',
        semanticCategoryId: 'semantic-v1:personal-information',
        playbackContentId: 'listening-playback-v1-00000002',
        source: { sourceType: 'listening-extension', sourceId: dictationQuestion.id, variantId: 'keyword-dictation' },
      },
    ]
    const provider: ListeningSupplyProvider = {
      async next(request) {
        const itemId = request.supplyRound?.order[request.supplyRound.cursor]
        const item = items.find((candidate) => candidate.itemId === itemId)
        if (!item) throw new Error('Route must forward supplyRound before asking for listening content.')
        return { schemaVersion: 1, requestId: request.requestId, status: 'item', item, nextCursor: item.itemId }
      },
    }
    const task = createListeningTask({ trainingBudget: { schemaVersion: 1, targetEffectiveSeconds: 900 } })

    const initialize = async (round: ReturnType<typeof createTrainingSupplyRound>, store: MemoryStore) =>
      createListeningTrainingRouteRuntime(props({
        task,
        contentSource: { load: async () => catalog },
        repository: new ListeningSessionRepository(store),
        speech: availableSpeech,
        supplyProvider: provider,
        supplyRound: round,
        trainingBudgetStatus: () => 'running',
      }), networkStatus).initialize()

    const choiceRound = createTrainingSupplyRound({ seed: 'route-choice', candidates: [{ itemId: 'route-choice', knowledgePointId: items[0]!.knowledgePointId, semanticCategoryId: items[0]!.semanticCategoryId }], shortTermExcludedItemIds: [] })
    const choiceStore = new MemoryStore()
    const choice = await initialize(choiceRound, choiceStore)
    expect(choice.failure).toBeNull()
    expect(choice.questions[0]?.type).toBe('word-discrimination')
    if (choice.questions[0]?.type === 'keyword-dictation') throw new Error('Expected a choice question.')
    expect(choice.questions[0]?.options[0]?.translationZh).toBe('玛雅')
    expect(choice.stream?.supplyRound).toMatchObject({ order: choiceRound.order, cursor: 1 })
    const restoredChoice = await initialize(choiceRound, choiceStore)
    expect(restoredChoice.stream?.supplyRound).toEqual(choice.stream?.supplyRound)

    const dictationRound = createTrainingSupplyRound({ seed: 'route-dictation', candidates: [{ itemId: 'route-dictation', knowledgePointId: items[1]!.knowledgePointId, semanticCategoryId: items[1]!.semanticCategoryId }], shortTermExcludedItemIds: [] })
    const dictation = await initialize(dictationRound, new MemoryStore())
    expect(dictation.questions[0]?.type).toBe('keyword-dictation')
    if (dictation.questions[0]?.type !== 'keyword-dictation') throw new Error('Expected a dictation question.')
    expect(dictation.questions[0].answerGuidance).toEqual(dictationQuestion.answerGuidance)
    expect(dictation.stream?.supplyRound).toMatchObject({ order: dictationRound.order, cursor: 1 })
  })
})
