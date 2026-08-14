import { describe, expect, it } from 'vitest'
import {
  applyLearningEngineExtraTrainingEvent,
  applyLearningEngineTrainingEvent,
  createExtraTrainingSession,
  createExtraTrainingState,
  createLearningEngineState,
  createPlanProgress,
  parseExtraTrainingEvent,
  parseLearningEvent,
} from './index.ts'
import { createInitialProgressState } from './progress.ts'
import { generateDailyPlan } from './scheduler.ts'
import { abilityProfile, learningCandidate } from './test-fixtures.ts'
import { createTrainingSupplyRound } from './training-randomization.ts'

const semanticCandidate = (
  itemId: string,
  knowledgePointId: string,
  semanticCategoryId: string,
) => ({ itemId, knowledgePointId, semanticCategoryId })

function dailyProgress(localDate = '2026-08-11') {
  const plan = generateDailyPlan({
    planId: `plan-${localDate}`,
    generatedAt: `${localDate}T00:00:00.000Z`,
    localDate,
    progress: createInitialProgressState(abilityProfile(), `${localDate}T00:00:00.000Z`),
    reviewItems: {},
    candidates: [
      learningCandidate('vocabulary', 1),
      learningCandidate('listening', 1),
      learningCandidate('speaking', 1),
    ],
  })
  return createPlanProgress(plan, plan.generatedAt)
}

function completedDailyProgress(localDate = '2026-08-11') {
  const progress = dailyProgress(localDate)
  return {
    ...progress,
    status: 'completed' as const,
    tasks: progress.tasks.map((entry) => ({ ...entry, status: 'completed' as const })),
  }
}

function planItemEvent(
  progress: ReturnType<typeof dailyProgress>,
  id = 'plan-item-1',
  itemId = 'daily-vocabulary-item',
  supplyRound?: ReturnType<typeof createTrainingSupplyRound>,
) {
  const task = progress.plan.tasks[0]
  return parseLearningEvent({
    id,
    type: 'learning.training.item.completed.v1',
    sourceModuleId: task.targetModuleId,
    schemaVersion: 1,
    occurredAt: `${progress.plan.localDate}T01:00:00.000Z`,
    payload: {
      planId: task.planId,
      taskId: task.taskId,
      learningUnitId: task.learningUnitId,
      contentRef: task.contentRef,
      domain: task.domain,
      targetModuleId: task.targetModuleId,
      localDate: progress.plan.localDate,
      mode: task.mode,
      requestId: `${task.taskId}:supply:1:initial`,
      nextSupplyCursor: 'cursor-2',
      outcome: 'scored',
      item: {
        itemId,
        learningUnitId: task.learningUnitId,
        contentRef: task.contentRef,
        difficultyLevel: task.difficultyLevel,
        tags: task.tags,
      },
      ...(supplyRound === undefined ? {} : { supplyRound }),
    },
  })
}

describe('R11 training event state', () => {
  it('updates the daily task and its recent-12 ledger in one item-completed transition', () => {
    const progress = dailyProgress()
    const engineState = createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z')

    const result = applyLearningEngineTrainingEvent({
      engineState,
      progress,
      event: planItemEvent(progress),
    })

    expect(result.progress.tasks[0].training?.completedItemIds).toEqual(['daily-vocabulary-item'])
    expect(result.engineState.recentTrainingItemIds).toEqual({
      'vocabulary:learn:5': ['daily-vocabulary-item'],
    })
  })

  it('does not update the daily ledger twice for a duplicate event and keeps it across a new day', () => {
    const firstProgress = dailyProgress()
    const initial = createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z')
    const event = planItemEvent(firstProgress)
    const first = applyLearningEngineTrainingEvent({ engineState: initial, progress: firstProgress, event })
    const duplicate = applyLearningEngineTrainingEvent({ engineState: first.engineState, progress: first.progress, event })

    expect(duplicate).toEqual(first)
    expect(duplicate.engineState.recentTrainingItemIds?.['vocabulary:learn:5']).toEqual(['daily-vocabulary-item'])
  })

  it('retains daily cooldown history when the next day starts a new plan', () => {
    const firstProgress = dailyProgress('2026-08-11')
    const first = applyLearningEngineTrainingEvent({
      engineState: createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z'),
      progress: firstProgress,
      event: planItemEvent(firstProgress, 'day-one-item', 'yesterday-item'),
    })
    const nextProgress = dailyProgress('2026-08-12')
    const next = applyLearningEngineTrainingEvent({
      engineState: first.engineState,
      progress: nextProgress,
      event: planItemEvent(nextProgress, 'day-two-item', 'today-item'),
    })

    expect(next.engineState.recentTrainingItemIds?.['vocabulary:learn:5']).toEqual([
      'yesterday-item', 'today-item',
    ])
  })

  it('rejects a different supply round or a non-advancing cursor after a round is established', () => {
    const progress = dailyProgress()
    const firstRound = createTrainingSupplyRound({
      seed: 'round-a', candidateItemIds: ['first-item', 'second-item'], shortTermExcludedItemIds: [],
    })
    const first = applyLearningEngineTrainingEvent({
      engineState: createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z'),
      progress,
      event: planItemEvent(progress, 'round-first', firstRound.order[0]!, { ...firstRound, cursor: 1 }),
    })
    const differentRound = createTrainingSupplyRound({
      seed: 'round-b', candidateItemIds: ['other-item'], shortTermExcludedItemIds: [],
    })

    expect(() => applyLearningEngineTrainingEvent({
      engineState: first.engineState,
      progress: first.progress,
      event: planItemEvent(progress, 'round-different', differentRound.order[0]!, { ...differentRound, cursor: 1 }),
    })).toThrow('does not match the established training round')
    expect(() => applyLearningEngineTrainingEvent({
      engineState: first.engineState,
      progress: first.progress,
      event: planItemEvent(progress, 'round-backward', firstRound.order[0]!, { ...firstRound, cursor: 1 }),
    })).toThrow('must advance exactly one item')
  })

  it('does not mutate the ledger for an item event that arrives after the task has ended', () => {
    const progress = dailyProgress()
    const engineState = createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z')
    const endedProgress = {
      ...progress,
      tasks: progress.tasks.map((entry, index) => index === 0
        ? { ...entry, status: 'completed' as const }
        : entry),
    }

    const result = applyLearningEngineTrainingEvent({
      engineState,
      progress: endedProgress,
      event: planItemEvent(progress, 'late-item', 'late-item'),
    })

    expect(result.progress).toBe(endedProgress)
    expect(result.engineState).toBe(engineState)
  })

  it('updates the extra-training session and the shared ledger in one transition', () => {
    const completed = completedDailyProgress()
    const extraTraining = createExtraTrainingSession(createExtraTrainingState(), completed, {
      sessionId: 'extra-vocabulary',
      localDate: '2026-08-11',
      domain: 'vocabulary',
      targetModuleId: 'vocabulary',
      targetDifficulty: 3,
      priorityItemIds: {
        'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
      },
      startedAt: '2026-08-11T01:00:00.000Z',
    })
    const event = parseExtraTrainingEvent({
      id: 'extra-item-1',
      type: 'learning.extra-training.item.completed.v1',
      sourceModuleId: 'vocabulary',
      schemaVersion: 1,
      occurredAt: '2026-08-11T01:01:00.000Z',
      payload: {
        sessionId: 'extra-vocabulary', localDate: '2026-08-11', domain: 'vocabulary',
        targetModuleId: 'vocabulary', mode: 'learn', requestId: 'extra-request-1', nextSupplyCursor: 'cursor-2',
        item: { itemId: 'extra-vocabulary-item', learningUnitId: 'unit-extra', contentRef: 'lesson://extra', difficultyLevel: 3, tags: [] },
      },
    })
    const result = applyLearningEngineExtraTrainingEvent({
      engineState: createLearningEngineState(abilityProfile(), '2026-08-10T00:00:00.000Z'),
      extraTraining,
      event,
    })

    expect(result.extraTraining.sessions['extra-vocabulary']?.completedItemCount).toBe(1)
    expect(result.engineState.recentTrainingItemIds).toEqual({
      'vocabulary:learn:3': ['extra-vocabulary-item'],
    })
  })
})

describe('R15 cross-round semantic history', () => {
  it('atomically appends the acknowledged daily semantic identity and exposes it to a new round', () => {
    const progress = dailyProgress()
    const initialRound = createTrainingSupplyRound({
      seed: 'daily-semantic',
      candidates: [
        semanticCandidate('daily-a', 'knowledge-greeting', 'semantic-social'),
        semanticCandidate('daily-b', 'knowledge-hotel', 'semantic-lodging'),
      ],
      shortTermExcludedItemIds: [],
      shortTermHistory: [],
    })
    const next = initialRound.order[0]!
    const acknowledged = { ...initialRound, cursor: 1, shortTermHistory: [
      initialRound.orderAudit[0]!,
    ] }
    const result = applyLearningEngineTrainingEvent({
      engineState: createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z'),
      progress,
      event: planItemEvent(progress, 'semantic-daily-1', next, acknowledged),
    })
    const bucket = 'vocabulary:learn:5'

    expect(result.engineState.recentTrainingSemanticHistory?.[bucket]).toEqual([
      expect.objectContaining({
        itemId: next,
        knowledgePointId: initialRound.orderAudit[0]!.knowledgePointId,
        semanticCategoryId: initialRound.orderAudit[0]!.semanticCategoryId,
      }),
    ])
    const history = result.engineState.recentTrainingSemanticHistory![bucket]!
    const secondRound = createTrainingSupplyRound({
      seed: 'next-round',
      candidates: [
        semanticCandidate('variant', initialRound.orderAudit[0]!.knowledgePointId, 'semantic-other'),
        semanticCandidate('fresh', 'knowledge-fresh', 'semantic-fresh'),
      ],
      shortTermExcludedItemIds: history.map((entry) => entry.itemId),
      shortTermHistory: history,
    })
    expect(secondRound.order[0]).toBe('fresh')
  })

  it('bounds cross-round history to 12 and does not duplicate it for replayed events', () => {
    let engineState = createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z')
    for (let index = 0; index < 13; index += 1) {
      let progress = dailyProgress(`2026-08-${String(index + 1).padStart(2, '0')}`)
      const round = createTrainingSupplyRound({
        seed: `round-${index}`,
        candidates: [semanticCandidate(`item-${index}`, `knowledge-${index}`, `semantic-${index % 3}`)],
        shortTermExcludedItemIds: [],
        shortTermHistory: [],
      })
      const event = planItemEvent(progress, `semantic-${index}`, `item-${index}`, {
        ...round,
        cursor: 1,
        shortTermHistory: [round.orderAudit[0]!],
      })
      const result = applyLearningEngineTrainingEvent({ engineState, progress, event })
      engineState = result.engineState
      progress = result.progress
      if (index === 12) {
        expect(applyLearningEngineTrainingEvent({ engineState, progress, event }).engineState).toBe(engineState)
      }
    }
    expect(engineState.recentTrainingSemanticHistory?.['vocabulary:learn:5']).toHaveLength(12)
    expect(engineState.recentTrainingSemanticHistory?.['vocabulary:learn:5']?.[0]?.itemId).toBe('item-1')
  })

  it('does not invent semantic history for legacy schema-1 rounds', () => {
    const progress = dailyProgress()
    const legacy = createTrainingSupplyRound({
      seed: 'legacy-round', candidateItemIds: ['legacy-item'], shortTermExcludedItemIds: [],
    })
    const result = applyLearningEngineTrainingEvent({
      engineState: createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z'),
      progress,
      event: planItemEvent(progress, 'legacy-semantic', 'legacy-item', { ...legacy, cursor: 1 }),
    })

    expect(result.engineState.recentTrainingSemanticHistory).toEqual({})
  })

  it('atomically appends acknowledged semantic identity from extra training', () => {
    const completed = completedDailyProgress()
    const extraTraining = createExtraTrainingSession(createExtraTrainingState(), completed, {
      sessionId: 'semantic-extra', localDate: '2026-08-11', domain: 'vocabulary',
      targetModuleId: 'vocabulary', targetDifficulty: 3,
      priorityItemIds: {
        'recent-error': [], 'due-review': [], 'same-day-variant': [], 'new-optional-content': [],
      },
      startedAt: '2026-08-11T01:00:00.000Z',
    })
    const round = createTrainingSupplyRound({
      seed: 'extra-semantic',
      candidates: [semanticCandidate('extra-semantic-item', 'knowledge-extra', 'semantic-extra')],
      shortTermExcludedItemIds: [], shortTermHistory: [],
    })
    const event = parseExtraTrainingEvent({
      id: 'semantic-extra-event', type: 'learning.extra-training.item.completed.v1',
      sourceModuleId: 'vocabulary', schemaVersion: 1, occurredAt: '2026-08-11T01:01:00.000Z',
      payload: {
        sessionId: 'semantic-extra', localDate: '2026-08-11', domain: 'vocabulary',
        targetModuleId: 'vocabulary', mode: 'learn', requestId: 'request-extra',
        nextSupplyCursor: 'cursor-extra',
        item: {
          itemId: 'extra-semantic-item', learningUnitId: 'unit-extra',
          contentRef: 'lesson://extra', difficultyLevel: 3, tags: [],
        },
        supplyRound: { ...round, cursor: 1, shortTermHistory: [round.orderAudit[0]!] },
      },
    })
    const result = applyLearningEngineExtraTrainingEvent({
      engineState: createLearningEngineState(abilityProfile(), '2026-08-11T00:00:00.000Z'),
      extraTraining,
      event,
    })

    expect(result.engineState.recentTrainingSemanticHistory?.['vocabulary:learn:3']).toEqual([
      {
        itemId: 'extra-semantic-item',
        knowledgePointId: 'knowledge-extra',
        semanticCategoryId: 'semantic-extra',
      },
    ])
  })
})
