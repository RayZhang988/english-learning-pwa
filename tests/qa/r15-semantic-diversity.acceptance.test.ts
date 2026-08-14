import { describe, expect, it } from 'vitest'
import {
  collectEligibleSupplyCandidates,
  createProductionTrainingSupplyProviders,
  type ProductionTrainingSupplyProviders,
} from '../../src/app/learning/training-supply-providers.ts'
import {
  createTrainingSupplyRound,
  nextTrainingSupplyItem,
  recordTrainingSupplyItem,
  type ExtraTrainingSupplyRequest,
  type LearningTaskSupplyRequest,
  type SemanticTrainingSupplyRound,
  type TrainingModuleId,
} from '../../src/learning-engine/index.ts'
import { releasedCatalogs } from './fixtures/production-course.ts'

const MODULES = ['vocabulary', 'listening', 'speaking'] as const satisfies readonly TrainingModuleId[]
const PRIORITIES = ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const

function providers(): ProductionTrainingSupplyProviders {
  const catalogs = releasedCatalogs()
  return createProductionTrainingSupplyProviders({
    vocabulary: { load: async () => catalogs.vocabulary },
    listening: { load: async () => catalogs.listening },
    speaking: { load: async () => catalogs.speaking },
  })
}

function dailyRequest(moduleId: TrainingModuleId): LearningTaskSupplyRequest {
  return {
    schemaVersion: 1,
    requestId: `r15:daily:${moduleId}`,
    planId: 'r15:daily',
    taskId: `r15:daily:${moduleId}:task`,
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    targetDifficulty: 1,
    cursor: null,
    excludeItemIds: [],
    reason: 'initial',
  }
}

function extraRequest(moduleId: TrainingModuleId): ExtraTrainingSupplyRequest {
  return {
    schemaVersion: 1,
    requestId: `r15:extra:${moduleId}`,
    sessionId: `r15:extra:${moduleId}:session`,
    localDate: '2026-08-14',
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    targetDifficulty: 1,
    cursor: null,
    excludeItemIds: [],
    priority: PRIORITIES,
    priorityItemIds: {
      'recent-error': [],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    },
    reason: 'initial',
  }
}

function expectStrictFirstThirty(round: SemanticTrainingSupplyRound): void {
  const firstThirty = round.orderAudit.slice(0, 30)
  expect(firstThirty).toHaveLength(30)
  for (let index = 1; index < firstThirty.length; index += 1) {
    expect(firstThirty[index]!.knowledgePointId).not.toBe(firstThirty[index - 1]!.knowledgePointId)
  }
  for (let index = 2; index < firstThirty.length; index += 1) {
    expect(new Set(firstThirty.slice(index - 2, index + 1).map((item) => item.semanticCategoryId)).size)
      .toBeGreaterThan(1)
  }
}

describe('R15 production semantic-diversity acceptance', () => {
  it('builds deterministic strict first-30 daily and R6 rounds for all released domains', async () => {
    const released = providers()
    for (const moduleId of MODULES) {
      for (const request of [dailyRequest(moduleId), extraRequest(moduleId)]) {
        const startedAt = performance.now()
        const eligible = await collectEligibleSupplyCandidates(released[moduleId], request)
        const round = createTrainingSupplyRound({
          seed: `r15:${moduleId}:${'sessionId' in request ? 'extra' : 'daily'}`,
          candidates: eligible.candidates,
          priorityItems: eligible.priorityItems,
          shortTermExcludedItemIds: [],
          shortTermHistory: [],
        })
        const sameSeed = createTrainingSupplyRound({
          seed: round.seed,
          candidates: eligible.candidates,
          priorityItems: eligible.priorityItems,
          shortTermExcludedItemIds: [],
          shortTermHistory: [],
        })

        expect(round).toEqual(sameSeed)
        expect(round.relaxationTier).toBe(0)
        expectStrictFirstThirty(round)
        expect(performance.now() - startedAt).toBeLessThan(2_000)
      }
    }
  }, 20_000)

  it('carries the last 12 semantic identities across a new round and restores without reshuffling', async () => {
    const released = providers()
    for (const moduleId of MODULES) {
      const eligible = await collectEligibleSupplyCandidates(released[moduleId], dailyRequest(moduleId))
      let first = createTrainingSupplyRound({
        seed: `r15:${moduleId}:first`, candidates: eligible.candidates,
        shortTermExcludedItemIds: [], shortTermHistory: [],
      })
      for (let index = 0; index < 12; index += 1) {
        const next = nextTrainingSupplyItem(first)
        if (next.status !== 'item') throw new Error(`${moduleId} exhausted before the cross-round window was filled`)
        first = recordTrainingSupplyItem(first, next.itemId)
      }
      const history = first.shortTermHistory
      const second = createTrainingSupplyRound({
        seed: `r15:${moduleId}:second`, candidates: eligible.candidates,
        shortTermExcludedItemIds: first.shortTermExcludedItemIds, shortTermHistory: history,
      })
      const restored = JSON.parse(JSON.stringify(second)) as SemanticTrainingSupplyRound
      expect(restored).toEqual(second)
      expect(nextTrainingSupplyItem(restored)).toEqual(nextTrainingSupplyItem(second))
      expect(second.order.some((itemId) => first.shortTermExcludedItemIds.includes(itemId))).toBe(false)
      expectStrictFirstThirty(second)
    }
  }, 20_000)

  it('allows only an explicit R6 priority override and preserves its reason', async () => {
    const released = providers()
    for (const moduleId of MODULES) {
      const base = extraRequest(moduleId)
      const initial = await collectEligibleSupplyCandidates(released[moduleId], base)
      const priority = initial.candidates[0]!
      const request: ExtraTrainingSupplyRequest = {
        ...base,
        requestId: `${base.requestId}:priority`,
        excludeItemIds: [priority.itemId],
        priorityItemIds: { ...base.priorityItemIds, 'recent-error': [priority.itemId] },
      }
      const eligible = await collectEligibleSupplyCandidates(released[moduleId], request)
      const round = createTrainingSupplyRound({
        seed: `r15:${moduleId}:priority`, candidates: eligible.candidates,
        priorityItems: eligible.priorityItems,
        shortTermExcludedItemIds: [priority.itemId], shortTermHistory: [priority],
      })
      expect(round.orderAudit[0]).toMatchObject({ itemId: priority.itemId, priorityReason: 'recent-error' })
    }
  }, 20_000)

  it('rejects damaged production semantic metadata instead of silently falling back', async () => {
    const request = dailyRequest('vocabulary')
    const invalid = {
      maximumCandidateCount: async () => 1,
      eligibleCandidateIdentities: async () => ({
        schemaVersion: 2,
        requestId: request.requestId,
        status: 'eligible-candidates',
        candidates: [{ itemId: 'broken', knowledgePointId: '', semanticCategoryId: 'semantic' }],
      }),
      next: async () => { throw new Error('legacy fallback must not run') },
    }
    await expect(collectEligibleSupplyCandidates(invalid, request)).rejects.toThrow(
      'invalid semantic candidate identity',
    )
  })
})
