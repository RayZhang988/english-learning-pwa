import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1/listening.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createListeningCatalog } from './content.ts'
import { resolveListeningSupplyQuestion, ListeningCatalogSupplyProvider } from './supply.ts'
import { createTrainingSupplyRound } from '../../learning-engine/index.ts'
import type { ListeningSupplyItem } from './types.ts'

function catalog() {
  return createListeningCatalog({
    packageIndex,
    manifest,
    extensionIndex,
    trainingSupplyIndex,
    lessonsByPath: {
      [packageIndex.lessonFiles[0]]: week1,
      [packageIndex.lessonFiles[1]]: week2,
      [packageIndex.lessonFiles[2]]: week3,
      [packageIndex.lessonFiles[3]]: week4,
    },
    exerciseBundlesByPath: {
      [extensionIndex.exerciseBundleFiles[0]]: exercises,
    },
    bilingualChoiceOptions,
  })
}

describe('listening training supply', () => {
  it('bulk-enumerates schema-2 identities with published semantic metadata and unique playback', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const request = { schemaVersion: 1 as const, requestId: 'semantic-eligible', planId: 'plan', taskId: 'task', domain: 'listening' as const, targetModuleId: 'listening' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [] as readonly string[], reason: 'initial' as const }

    const result = await provider.eligibleCandidateIdentities(request)

    expect(result.status).toBe('eligible-candidates')
    if (result.status !== 'eligible-candidates') return
    expect(result.candidates.length).toBeGreaterThan(300)
    expect(result.candidates[0]).toEqual({
      itemId: expect.any(String),
      knowledgePointId: expect.stringMatching(/^knowledge-v1-listening-/u),
      semanticCategoryId: expect.stringMatching(/^semantic-v1/u),
    })
    expect(Object.keys(result.candidates[0]!)).toEqual([
      'itemId', 'knowledgePointId', 'semanticCategoryId',
    ])
    const itemById = new Map((trainingSupplyIndex.candidates as readonly ListeningSupplyItem[])
      .map((item) => [item.itemId, item]))
    const playbackIds = result.candidates.map((identity) =>
      itemById.get(identity.itemId)!.playbackContentId)
    expect(new Set(playbackIds)).toHaveLength(playbackIds.length)
  })

  it('uses schema-2 order as the only order even for an extra-training priority request', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const base = { schemaVersion: 1 as const, requestId: 'semantic-extra', sessionId: 'extra', localDate: '2026-08-14', domain: 'listening' as const, targetModuleId: 'listening' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [] as readonly string[], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'] as const, priorityItemIds: { 'recent-error': [] as readonly string[], 'due-review': [] as readonly string[], 'same-day-variant': [] as readonly string[], 'new-optional-content': [] as readonly string[] }, reason: 'initial' as const }
    const eligible = await provider.eligibleCandidateIdentities(base)
    expect(eligible.status).toBe('eligible-candidates')
    if (eligible.status !== 'eligible-candidates') return
    const [first, second] = eligible.candidates
    expect(first).toBeDefined(); expect(second).toBeDefined()
    const round = createTrainingSupplyRound({
      seed: 'semantic-extra-round', candidates: [second!, first!],
      shortTermExcludedItemIds: [],
      priorityItems: [{ itemId: second!.itemId, reason: 'recent-error' }],
    })
    const result = await provider.next({
      ...base,
      supplyRound: round,
      priorityItemIds: { ...base.priorityItemIds, 'recent-error': [first!.itemId] },
    })
    expect(result).toMatchObject({ status: 'item', item: { itemId: second!.itemId } })
  })

  it('returns honest priority reasons and replaces a same-day seed with a distinct audio variant', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const released = (trainingSupplyIndex.candidates as readonly (ListeningSupplyItem & { readonly variantFamilyId: string; readonly allowedModes: readonly string[] })[])
      .filter((item) => item.domain === 'listening' && item.allowedModes?.includes('learn') && Math.abs(item.difficultyLevel - 1) <= 1.5)
    const seed = released.find((item) => released.some((other) => other.itemId !== item.itemId && other.variantFamilyId === item.variantFamilyId && other.playbackContentId !== item.playbackContentId))!
    const result = await provider.eligibleCandidateIdentities({ schemaVersion: 1, requestId: 'eligible-priority', sessionId: 'extra', localDate: '2026-08-14', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], priority: ['recent-error', 'due-review', 'same-day-variant', 'new-optional-content'], priorityItemIds: { 'recent-error': [], 'due-review': [], 'same-day-variant': [seed.itemId], 'new-optional-content': [] }, reason: 'initial' })
    expect(result.status).toBe('eligible-candidates')
    if (result.status !== 'eligible-candidates') return
    expect(result.candidates.map((item) => item.itemId)).not.toContain(seed.itemId)
    expect(result.priorityItems).toHaveLength(1)
    expect(result.priorityItems[0]?.reason).toBe('same-day-variant')
    const selected = released.find((item) => item.itemId === result.priorityItems[0]?.itemId)!
    expect(selected.variantFamilyId).toBe(seed.variantFamilyId)
    expect(selected.playbackContentId).not.toBe(seed.playbackContentId)
  })

  it('keeps the first 30 schema-2 items diverse without duplicating knowledge or playback identities', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const request = { schemaVersion: 1 as const, requestId: 'first-30', planId: 'plan', taskId: 'task', domain: 'listening' as const, targetModuleId: 'listening' as const, mode: 'learn' as const, targetDifficulty: 1, cursor: null, excludeItemIds: [] as readonly string[], reason: 'initial' as const }
    const eligible = await provider.eligibleCandidateIdentities(request)
    expect(eligible.status).toBe('eligible-candidates')
    if (eligible.status !== 'eligible-candidates') return
    const round = createTrainingSupplyRound({ seed: 'first-30-listening', candidates: eligible.candidates, shortTermExcludedItemIds: [] })
    const itemsById = new Map((trainingSupplyIndex.candidates as readonly (ListeningSupplyItem & { readonly semanticCategoryId: string; readonly knowledgePointId: string })[])
      .map((item) => [item.itemId, item]))
    const firstThirty = round.order.slice(0, 30).map((itemId) => itemsById.get(itemId)!)
    expect(firstThirty).toHaveLength(30)
    expect(new Set(firstThirty.map((item) => item.playbackContentId))).toHaveLength(30)
    expect(new Set(firstThirty.map((item) => item.source.variantId)).size).toBeGreaterThan(1)
    for (let index = 1; index < firstThirty.length; index += 1) {
      expect(firstThirty[index]!.knowledgePointId).not.toBe(firstThirty[index - 1]!.knowledgePointId)
      const semanticRun = firstThirty.slice(Math.max(0, index - 2), index + 1)
      expect(new Set(semanticRun.map((item) => item.semanticCategoryId)).size).toBeGreaterThan(1)
    }
  })

  it('bulk-enumerates the released listening pool without provider iteration', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const startedAt = performance.now()
    const result = await provider.eligibleCandidateIdentities({ schemaVersion: 1, requestId: 'bulk-performance', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' })
    expect(result.status).toBe('eligible-candidates')
    expect(performance.now() - startedAt).toBeLessThan(100)
  })

  it('rejects missing or malformed semantic metadata at the listening boundary', () => {
    const current = catalog()
    const source = (trainingSupplyIndex.candidates as readonly Record<string, unknown>[])
      .find((candidate) => candidate.domain === 'listening')!
    for (const patch of [
      { knowledgePointId: undefined },
      { knowledgePointId: '' },
      { semanticCategoryId: undefined },
      { semanticCategoryId: 'not-published' },
    ]) {
      expect(() => new ListeningCatalogSupplyProvider({
        schemaVersion: 1,
        candidates: [{ ...source, ...patch }],
      }, current)).toThrow(/semantic|listening fields/u)
    }
  })

  it('uses the persisted randomized round instead of its independent session rank', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const candidates = (current.trainingSupplyIndex as { candidates: { itemId: string; difficultyLevel: number; domain: string }[] }).candidates
      .filter((candidate) => candidate.domain === 'listening' && candidate.difficultyLevel === 1)
    const round = ['listening-a', 'listening-b', 'listening-c'].map((seed) => createTrainingSupplyRound({ seed, candidateItemIds: candidates.map((candidate) => candidate.itemId), shortTermExcludedItemIds: [] })).find((candidate) => candidate.order[0] !== candidates[0]?.itemId)!
    const result = await provider.next({ schemaVersion: 1, requestId: 'round', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], supplyRound: round, reason: 'initial' })
    expect(result).toMatchObject({ status: 'item', item: { itemId: round.order[0] } })
  })
  it('selects stable non-repeating approved listening items from all three source types', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const first = await provider.next({ schemaVersion: 1, requestId: 'request-1', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' })
    expect(first).toMatchObject({ status: 'item' })
    if (first.status !== 'item') return
    const second = await provider.next({ schemaVersion: 1, requestId: 'request-2', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: first.nextCursor, excludeItemIds: [first.item.itemId], reason: 'continue-after-item' })
    expect(second).toMatchObject({ status: 'item' })
    if (second.status !== 'item') return
    expect(second.item.itemId).not.toBe(first.item.itemId)
    const supplied = first.item as import('./types.ts').ListeningSupplyItem
    const resolved = resolveListeningSupplyQuestion(current, supplied)
    expect(resolved.question.id).toBe(supplied.source.sourceId)
    expect(current.trainingSupplyIndex).toBeDefined()
  })

  it('reports exhaustion instead of clearing exclusions and looping', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const all = (trainingSupplyIndex.candidates as { readonly itemId: string }[])
      .filter((item) => item.itemId.includes('-listening-'))
      .map((item) => item.itemId)
    const result = await provider.next({ schemaVersion: 1, requestId: 'request', planId: 'plan', taskId: 'task', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: all, reason: 'continue-after-item' })
    expect(result).toMatchObject({ status: 'content-exhausted', reason: 'all-eligible-content-recently-used' })
  })

  it.each([0, 0.5, 1, 2.5, 4, 5.5])(
    'shuffles target %s without repeating an item, dialogue family, or adjacent question type',
    async (targetDifficulty) => {
      const current = catalog()
      const provider = new ListeningCatalogSupplyProvider(
        current.trainingSupplyIndex,
        current,
      )
      const supplied: Array<{
        itemId: string
        variantFamilyId: string
        variantId: string
      }> = []
      let cursor: string | null = null
      for (let index = 0; index < 24; index += 1) {
        const result = await provider.next({
          schemaVersion: 1,
          requestId: `diversity-${targetDifficulty}-${index}`,
          planId: `plan-${targetDifficulty}`,
          taskId: `task-${targetDifficulty}`,
          domain: 'listening',
          targetModuleId: 'listening',
          mode: 'learn',
          targetDifficulty,
          cursor,
          excludeItemIds: supplied.map((item) => item.itemId),
          reason: index === 0 ? 'initial' : 'continue-after-item',
        })
        expect(result.status).toBe('item')
        if (result.status !== 'item') return
        const item = result.item as ListeningSupplyItem & {
          readonly variantFamilyId: string
        }
        supplied.push({
          itemId: item.itemId,
          variantFamilyId: item.variantFamilyId,
          variantId: item.source.variantId,
        })
        cursor = result.nextCursor
      }

      expect(new Set(supplied.map((item) => item.itemId))).toHaveLength(24)
      for (const [index, item] of supplied.entries()) {
        const recent = supplied.slice(Math.max(0, index - 4), index)
        expect(recent.map((entry) => entry.variantFamilyId))
          .not.toContain(item.variantFamilyId)
        if (index > 0) {
          expect(item.variantId).not.toBe(supplied[index - 1].variantId)
        }
      }
    },
  )

  it('durably excludes published playback identities for the first 30 ordinary items', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(current.trainingSupplyIndex, current)
    const completed: string[] = []
    const playbackIdentities: string[] = []
    let cursor: string | null = null
    for (let index = 0; index < 30; index += 1) {
      const result = await provider.next({
        schemaVersion: 1, requestId: `playback-identity-${index}`,
        planId: 'playback-identity-plan', taskId: 'playback-identity-task',
        domain: 'listening', targetModuleId: 'listening', mode: 'learn',
        targetDifficulty: 1, cursor, excludeItemIds: completed,
        reason: index === 0 ? 'initial' : 'continue-after-item',
      })
      expect(result.status).toBe('item')
      if (result.status !== 'item') return
      const item = result.item as ListeningSupplyItem
      completed.push(item.itemId)
      playbackIdentities.push(item.playbackContentId)
      cursor = result.nextCursor
    }
    expect(new Set(playbackIdentities)).toHaveLength(30)
    // The same request reconstructed from persisted item IDs produces the
    // same next item; no separate volatile content-exclusion state exists.
    const restored = await provider.next({
      schemaVersion: 1, requestId: 'playback-identity-restored',
      planId: 'playback-identity-plan', taskId: 'playback-identity-task',
      domain: 'listening', targetModuleId: 'listening', mode: 'learn',
      targetDifficulty: 1, cursor, excludeItemIds: completed,
      reason: 'continue-after-item',
    })
    expect(restored.status).toBe('item')
    if (restored.status === 'item') {
      expect(playbackIdentities).not.toContain((restored.item as ListeningSupplyItem).playbackContentId)
    }
  })

  it('honestly relaxes the family cooldown only when the eligible pool has no other family', async () => {
    const current = catalog()
    const all = trainingSupplyIndex.candidates as readonly Record<string, unknown>[]
    const family = all.find((candidate) => candidate.domain === 'listening')?.variantFamilyId
    const familyOnlyIndex = {
      schemaVersion: 1,
      candidates: all.filter((candidate) => candidate.variantFamilyId === family),
    }
    const provider = new ListeningCatalogSupplyProvider(familyOnlyIndex, current)
    const first = await provider.next({
      schemaVersion: 1, requestId: 'family-only-first', planId: 'family-only', taskId: 'family-only',
      domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1,
      cursor: null, excludeItemIds: [], reason: 'initial',
    })
    expect(first.status).toBe('item')
    if (first.status !== 'item') return
    const second = await provider.next({
      schemaVersion: 1, requestId: 'family-only-second', planId: 'family-only', taskId: 'family-only',
      domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1,
      cursor: first.nextCursor, excludeItemIds: [first.item.itemId], reason: 'continue-after-item',
    })
    expect(second).toMatchObject({ status: 'item' })
    if (second.status === 'item') {
      expect(second.item.variantFamilyId).toBe(first.item.variantFamilyId)
    }
  })

  it('honestly relaxes adjacent-type avoidance only when the eligible pool has no other type', async () => {
    const current = catalog()
    const all = trainingSupplyIndex.candidates as readonly Record<string, unknown>[]
    const type = (all.find((candidate) => candidate.domain === 'listening')?.source as { variantId?: string })?.variantId
    const sameTypeIndex = {
      schemaVersion: 1,
      candidates: all.filter((candidate) => (candidate.source as { variantId?: string })?.variantId === type),
    }
    const provider = new ListeningCatalogSupplyProvider(sameTypeIndex, current)
    const first = await provider.next({ schemaVersion: 1, requestId: 'type-only-first', planId: 'type-only', taskId: 'type-only', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: null, excludeItemIds: [], reason: 'initial' })
    expect(first.status).toBe('item')
    if (first.status !== 'item') return
    const second = await provider.next({ schemaVersion: 1, requestId: 'type-only-second', planId: 'type-only', taskId: 'type-only', domain: 'listening', targetModuleId: 'listening', mode: 'learn', targetDifficulty: 1, cursor: first.nextCursor, excludeItemIds: [first.item.itemId], reason: 'continue-after-item' })
    expect(second).toMatchObject({ status: 'item' })
    if (second.status === 'item') {
      expect((second.item as ListeningSupplyItem).source.variantId)
        .toBe((first.item as ListeningSupplyItem).source.variantId)
    }
  })

  it('keeps a restored next item stable while different plans receive different shuffled orders', async () => {
    const current = catalog()
    const provider = new ListeningCatalogSupplyProvider(
      current.trainingSupplyIndex,
      current,
    )
    async function sequence(planId: string) {
      const ids: string[] = []
      let cursor: string | null = null
      for (let index = 0; index < 20; index += 1) {
        const request = {
          schemaVersion: 1 as const,
          requestId: `${planId}:${index}`,
          planId,
          taskId: `${planId}:listening`,
          domain: 'listening' as const,
          targetModuleId: 'listening' as const,
          mode: 'learn' as const,
          targetDifficulty: 1,
          cursor,
          excludeItemIds: ids,
          reason: index === 0
            ? 'initial' as const
            : 'continue-after-item' as const,
        }
        const first = await provider.next(request)
        const restored = await provider.next({
          ...request,
          requestId: `${request.requestId}:retry`,
        })
        expect(restored.status).toBe(first.status)
        expect(
          restored.status === 'item' ? restored.item.itemId : null,
        ).toBe(first.status === 'item' ? first.item.itemId : null)
        expect(first.status).toBe('item')
        if (first.status !== 'item') return ids
        ids.push(first.item.itemId)
        cursor = first.nextCursor
      }
      return ids
    }

    const first = await sequence('shuffle-a')
    const second = await sequence('shuffle-b')
    expect(
      first.filter((itemId, index) => itemId !== second[index]).length,
    ).toBeGreaterThanOrEqual(14)
  })
})
