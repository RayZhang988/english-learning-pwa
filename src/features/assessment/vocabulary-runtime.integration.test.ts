import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import {
  AssessmentRuntimeError,
  createPlacementAssessmentRuntime,
} from './runtime.ts'
import {
  createVocabularyPlacementRuntime,
  restoreVocabularyPlacementRuntime,
} from './vocabulary-runtime.ts'
import type {
  AbilityProfileV2,
  PublicVocabularyAssessmentItemV2,
} from './vocabulary-types.ts'

const baseTime = Date.parse('2026-07-27T01:00:00.000Z')

function testClock() {
  let value = baseTime
  return {
    now: () => new Date(value).toISOString(),
    advance: (milliseconds: number) => {
      value += milliseconds
    },
  }
}

function vocabularyPrivateItem(itemId: string) {
  const item = vocabularyPlacementBankV2.items.find(
    (candidate) => candidate.id === itemId,
  )
  if (!item) {
    throw new Error(`Missing v2 vocabulary item ${itemId}`)
  }
  return item
}

async function answerVocabularyCorrectly(
  runtime: ReturnType<typeof createVocabularyPlacementRuntime>,
  clock: ReturnType<typeof testClock>,
  item: PublicVocabularyAssessmentItemV2,
) {
  const scoringItem = vocabularyPrivateItem(item.id)
  clock.advance(60_000)
  runtime.selectChoice(item.id, scoringItem.scoring.correctOptionId)
  return runtime.submitChoice(item.id)
}

async function completeStrongVocabularyAssessment(input?: {
  readonly onCompleted?: (profile: AbilityProfileV2) => void | Promise<void>
}) {
  const clock = testClock()
  const runtime = createVocabularyPlacementRuntime({
    now: clock.now,
    createId: () => 'vocabulary-runtime-complete',
    onCompleted: input?.onCompleted,
  })
  let state = await runtime.start()
  const difficulties: number[] = []

  for (let step = 0; step < 20; step += 1) {
    if (state.lifecycle === 'completed') {
      return { runtime, state, clock, difficulties }
    }
    if (state.lifecycle !== 'active' || !state.item) {
      throw new Error(`Unexpected lifecycle ${state.lifecycle}`)
    }
    expect(state.phase).toBe('vocabulary')
    expect(state.item.domain).toBe('vocabulary')
    expect(state.item.kind).toBe('choice')
    expect(state.item).not.toHaveProperty('scoring')
    expect(state.actions).not.toHaveProperty('canSubmitSpeech')
    difficulties.push(state.item.difficulty)
    state = await answerVocabularyCorrectly(runtime, clock, state.item)
    expect(state.lifecycle).toBe('feedback')
    state = await runtime.continue()
  }

  throw new Error('Vocabulary assessment exceeded its item cap')
}

async function legacySnapshotAtListening() {
  const clock = testClock()
  const runtime = createPlacementAssessmentRuntime({
    now: clock.now,
    createId: () => 'legacy-listening',
  })
  let state = await runtime.start()

  for (let step = 0; step < 30; step += 1) {
    if (
      state.lifecycle === 'active' &&
      state.phase === 'listening'
    ) {
      return { snapshot: runtime.toSnapshot(), clock }
    }
    if (
      state.lifecycle !== 'active' ||
      !state.item ||
      state.item.kind !== 'choice'
    ) {
      throw new Error('Legacy runtime ended before listening')
    }
    const privateItem = placementBankV1.items.find(
      (candidate) => candidate.id === state.item?.id,
    )
    if (!privateItem || privateItem.kind !== 'choice') {
      throw new Error('Expected legacy choice item')
    }
    clock.advance(60_000)
    runtime.selectChoice(
      privateItem.id,
      privateItem.scoring.correctOptionId,
    )
    state = await runtime.submitChoice(privateItem.id)
    state = await runtime.continue()
  }

  throw new Error('Legacy runtime did not reach listening')
}

describe('VocabularyPlacementRuntime v2 integration', () => {
  it('runs only vocabulary from a new session to one real v2 profile', async () => {
    const completed: AbilityProfileV2[] = []
    const { runtime, state, difficulties } =
      await completeStrongVocabularyAssessment({
        onCompleted: (profile) => {
          completed.push(profile)
        },
      })

    expect(difficulties.slice(0, 7)).toEqual([
      0, 2, 4, 6, 8, 10, 12,
    ])
    expect(state.lifecycle).toBe('completed')
    expect(state.phase).toBe('complete')
    expect(state.profile?.schemaVersion).toBe(2)
    expect(state.profile?.assessmentKind).toBe('adaptive-vocabulary')
    expect(state.profile?.durationSeconds).toBeGreaterThanOrEqual(8 * 60)
    expect(state.profile?.durationSeconds).toBeLessThanOrEqual(12 * 60)
    expect(state.profile?.vocabularySize.wordCountRange).toBeNull()
    expect(state.profile?.abilities.vocabulary.internalLevel).not.toBeNull()
    for (const domain of ['listening', 'speaking'] as const) {
      expect(state.profile?.abilities[domain]).toMatchObject({
        domain,
        status: 'unavailable',
        calibrationState: 'pending-calibration',
        internalLevel: null,
        cefrEstimate: 'unknown',
        confidence: 0,
      })
    }
    expect(completed).toEqual([state.profile])
    expect(JSON.stringify(runtime.toSnapshot())).not.toContain(
      'correctOptionId',
    )
  })

  it('restores a v2 active snapshot as paused without counting offline time', async () => {
    const clock = testClock()
    const runtime = createVocabularyPlacementRuntime({
      now: clock.now,
      createId: () => 'v2-resume',
    })
    let state = await runtime.start()
    if (!state.item) {
      throw new Error('Expected a v2 vocabulary item')
    }
    const itemId = state.item.id
    const optionId =
      vocabularyPrivateItem(itemId).scoring.correctOptionId

    clock.advance(25_000)
    runtime.selectChoice(itemId, optionId)
    const snapshot = runtime.toSnapshot()
    expect(snapshot.activeElapsedMs).toBe(25_000)

    clock.advance(24 * 60 * 60_000)
    const restored = restoreVocabularyPlacementRuntime({
      snapshot,
      now: clock.now,
    })
    expect(restored.state.lifecycle).toBe('paused')
    expect(restored.state.progress.elapsedSeconds).toBe(25)
    expect(restored.state.selectedOptionId).toBe(optionId)

    state = await restored.resume()
    expect(state.lifecycle).toBe('active')
    clock.advance(5_000)
    state = await restored.submitChoice(itemId)
    expect(state.lifecycle).toBe('feedback')
    expect(state.progress.elapsedSeconds).toBe(30)
  })

  it('imports an active v1 vocabulary snapshot without rewriting its source', async () => {
    const clock = testClock()
    const legacy = createPlacementAssessmentRuntime({
      now: clock.now,
      createId: () => 'legacy-vocabulary',
    })
    const active = await legacy.start()
    if (!active.item || active.item.kind !== 'choice') {
      throw new Error('Expected legacy vocabulary choice')
    }
    const privateItem = placementBankV1.items.find(
      (candidate) => candidate.id === active.item?.id,
    )
    if (!privateItem || privateItem.kind !== 'choice') {
      throw new Error('Expected private legacy choice')
    }
    clock.advance(20_000)
    legacy.selectChoice(
      privateItem.id,
      privateItem.scoring.correctOptionId,
    )
    const original = legacy.toSnapshot()

    const restored = restoreVocabularyPlacementRuntime({
      snapshot: original,
      now: clock.now,
    })
    const migrated = restored.toSnapshot()
    expect(restored.state.lifecycle).toBe('paused')
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.legacySource?.snapshot).toEqual(original)
    expect(migrated.session.responses).toHaveLength(0)

    const resumed = await restored.resume()
    expect(resumed.phase).toBe('vocabulary')
    expect(resumed.item?.id).toBe(active.item.id)
    expect(resumed.selectedOptionId).toBe(
      privateItem.scoring.correctOptionId,
    )
  })

  it('completes a v1 listening snapshot without resuming listening or speaking', async () => {
    const legacy = await legacySnapshotAtListening()
    const restored = restoreVocabularyPlacementRuntime({
      snapshot: legacy.snapshot,
      now: legacy.clock.now,
    })
    const state = restored.state

    expect(state.lifecycle).toBe('completed')
    expect(state.phase).toBe('complete')
    expect(state.item).toBeNull()
    expect(state.profile?.abilities.listening.calibrationState).toBe(
      'pending-calibration',
    )
    expect(state.profile?.abilities.speaking.calibrationState).toBe(
      'pending-calibration',
    )
    expect(restored.toSnapshot().legacySource?.snapshot).toEqual(
      legacy.snapshot,
    )
  })

  it('treats skip as uncertainty and rejects duplicate or stale submissions', async () => {
    const clock = testClock()
    const runtime = createVocabularyPlacementRuntime({
      now: clock.now,
      createId: () => 'v2-actions',
    })
    let state = await runtime.start()
    const first = state.item
    if (!first) {
      throw new Error('Expected first v2 item')
    }
    clock.advance(10_000)
    state = await runtime.skip(first.id)
    expect(state.lastSubmission).toEqual({
      itemId: first.id,
      status: 'uncertain',
    })
    expect(runtime.toSnapshot().session.responses[0]?.answer).toBe(
      'uncertain',
    )

    await expect(runtime.skip(first.id)).rejects.toMatchObject({
      code: 'invalid-transition',
    })
    state = await runtime.continue()
    expect(state.item?.id).not.toBe(first.id)
    await expect(runtime.skip(first.id)).rejects.toMatchObject({
      code: 'stale-item',
    })
  })

  it('enforces the fifteen-minute hard limit before scoring a late answer', async () => {
    const clock = testClock()
    const runtime = createVocabularyPlacementRuntime({
      now: clock.now,
      createId: () => 'v2-hard-limit',
    })
    let state = await runtime.start()
    if (!state.item) {
      throw new Error('Expected a v2 item')
    }
    runtime.selectChoice(
      state.item.id,
      vocabularyPrivateItem(state.item.id).scoring.correctOptionId,
    )
    clock.advance(16 * 60_000)
    state = await runtime.submitChoice(state.item.id)

    expect(state.lifecycle).toBe('completed')
    expect(state.profile?.durationSeconds).toBe(15 * 60)
    expect(state.profile?.outcome).toBe('partial')
    expect(runtime.toSnapshot().session.responses).toHaveLength(0)
  })

  it('allows no further actions after completion', async () => {
    const { runtime, state } =
      await completeStrongVocabularyAssessment()
    expect(state.lifecycle).toBe('completed')

    await expect(runtime.continue()).rejects.toBeInstanceOf(
      AssessmentRuntimeError,
    )
    await expect(runtime.start()).rejects.toBeInstanceOf(
      AssessmentRuntimeError,
    )
    await expect(runtime.stop()).rejects.toBeInstanceOf(
      AssessmentRuntimeError,
    )
  })
})
