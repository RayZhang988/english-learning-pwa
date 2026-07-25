import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { createPlacementAssessmentRuntime } from './runtime.ts'
import { parseAssessmentRuntimeSnapshot } from './snapshot.ts'

const now = () => '2026-07-25T01:00:00.000Z'

describe('assessment runtime snapshot validation', () => {
  it('rejects a future snapshot version', () => {
    const runtime = createPlacementAssessmentRuntime({
      now,
      createId: () => 'snapshot-version',
    })
    const snapshot = runtime.toSnapshot()

    expect(() =>
      parseAssessmentRuntimeSnapshot(
        { ...snapshot, schemaVersion: 2 },
        placementBankV1,
      ),
    ).toThrow('schemaVersion is unsupported')
  })

  it('rejects duplicate response evidence', async () => {
    const runtime = createPlacementAssessmentRuntime({
      now,
      createId: () => 'snapshot-duplicate',
    })
    let state = await runtime.start()
    const item = state.item
    if (!item || item.kind !== 'choice') {
      throw new Error('Expected a choice item')
    }
    const privateItem = placementBankV1.items.find(
      (candidate) => candidate.id === item.id,
    )
    if (!privateItem || privateItem.kind !== 'choice') {
      throw new Error('Expected a private choice item')
    }
    runtime.selectChoice(
      item.id,
      privateItem.scoring.correctOptionId,
    )
    state = await runtime.submitChoice(item.id)
    expect(state.lifecycle).toBe('feedback')
    const snapshot = runtime.toSnapshot()
    const response = snapshot.session.responses[0]
    if (!response) {
      throw new Error('Expected stored response')
    }

    const corrupted = {
      ...snapshot,
      session: {
        ...snapshot.session,
        responses: [...snapshot.session.responses, response],
      },
    }
    expect(() =>
      parseAssessmentRuntimeSnapshot(
        corrupted,
        placementBankV1,
      ),
    ).toThrow('duplicate item submissions')
  })

  it('rejects a selection that does not belong to the current item', async () => {
    const runtime = createPlacementAssessmentRuntime({
      now,
      createId: () => 'snapshot-option',
    })
    await runtime.start()
    const snapshot = runtime.toSnapshot()

    expect(() =>
      parseAssessmentRuntimeSnapshot(
        {
          ...snapshot,
          selectedOptionId: 'not-an-option',
        },
        placementBankV1,
      ),
    ).toThrow('selectedOptionId is not valid')
  })

  it('rejects an estimate whose counts do not match its responses', () => {
    const runtime = createPlacementAssessmentRuntime({
      now,
      createId: () => 'snapshot-counts',
    })
    const snapshot = runtime.toSnapshot()
    const corrupted = {
      ...snapshot,
      session: {
        ...snapshot.session,
        estimates: {
          ...snapshot.session.estimates,
          vocabulary: {
            ...snapshot.session.estimates.vocabulary,
            attemptedCount: 1,
          },
        },
      },
    }

    expect(() =>
      parseAssessmentRuntimeSnapshot(
        corrupted,
        placementBankV1,
      ),
    ).toThrow('counts do not match response evidence')
  })
})
