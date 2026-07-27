import { describe, expect, it } from 'vitest'
import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import { createPlacementAssessmentRuntime } from './runtime.ts'
import {
  createVocabularyPlacementRuntime,
  restoreVocabularyPlacementRuntime,
} from './vocabulary-runtime.ts'
import {
  parseVocabularyAssessmentRuntimeSnapshotV2,
} from './vocabulary-snapshot.ts'

const now = () => '2026-07-27T02:00:00.000Z'

describe('v2 vocabulary runtime snapshot validation', () => {
  it('round-trips an active snapshot', async () => {
    const runtime = createVocabularyPlacementRuntime({
      now,
      createId: () => 'snapshot-roundtrip',
    })
    await runtime.start()
    const snapshot = runtime.toSnapshot()

    expect(
      parseVocabularyAssessmentRuntimeSnapshotV2(
        snapshot,
        vocabularyPlacementBankV2,
      ),
    ).toEqual(snapshot)
  })

  it('rejects a future snapshot version', () => {
    const snapshot = createVocabularyPlacementRuntime({
      now,
      createId: () => 'snapshot-future',
    }).toSnapshot()

    expect(() =>
      parseVocabularyAssessmentRuntimeSnapshotV2(
        { ...snapshot, schemaVersion: 3 },
        vocabularyPlacementBankV2,
      ),
    ).toThrow('snapshot identity is incompatible')
  })

  it('rejects an estimate that does not match its response evidence', () => {
    const snapshot = createVocabularyPlacementRuntime({
      now,
      createId: () => 'snapshot-estimate',
    }).toSnapshot()
    const corrupted = {
      ...snapshot,
      session: {
        ...snapshot.session,
        estimate: {
          ...snapshot.session.estimate,
          attemptedCount: 1,
        },
      },
    }

    expect(() =>
      parseVocabularyAssessmentRuntimeSnapshotV2(
        corrupted,
        vocabularyPlacementBankV2,
      ),
    ).toThrow('estimate does not match response evidence')
  })

  it('rejects a completed profile that fabricates a calibrated domain', async () => {
    const runtime = createVocabularyPlacementRuntime({
      now,
      createId: () => 'snapshot-profile',
    })
    await runtime.start()
    await runtime.stop()
    const snapshot = runtime.toSnapshot()
    if (!snapshot.profile) {
      throw new Error('Expected completed profile')
    }
    const corrupted = {
      ...snapshot,
      profile: {
        ...snapshot.profile,
        abilities: {
          ...snapshot.profile.abilities,
          listening: {
            ...snapshot.profile.abilities.listening,
            internalLevel: 5,
            cefrEstimate: 'B1',
            confidence: 0.8,
          },
        },
      },
    }

    expect(() =>
      parseVocabularyAssessmentRuntimeSnapshotV2(
        corrupted,
        vocabularyPlacementBankV2,
      ),
    ).toThrow('listening must remain pending calibration')
  })

  it('rejects a vocabulary result that does not match session evidence', async () => {
    const runtime = createVocabularyPlacementRuntime({
      now,
      createId: () => 'snapshot-vocabulary-profile',
    })
    await runtime.start()
    await runtime.stop()
    const snapshot = runtime.toSnapshot()
    if (!snapshot.profile) {
      throw new Error('Expected completed profile')
    }
    const corrupted = {
      ...snapshot,
      profile: {
        ...snapshot.profile,
        abilities: {
          ...snapshot.profile.abilities,
          vocabulary: {
            ...snapshot.profile.abilities.vocabulary,
            confidence: 0.99,
          },
        },
      },
    }

    expect(() =>
      parseVocabularyAssessmentRuntimeSnapshotV2(
        corrupted,
        vocabularyPlacementBankV2,
      ),
    ).toThrow('profile does not match session evidence')
  })

  it('rejects a corrupted preserved v1 source', async () => {
    const legacy = createPlacementAssessmentRuntime({
      now,
      createId: () => 'snapshot-legacy',
    })
    await legacy.start()
    const migrated = restoreVocabularyPlacementRuntime({
      snapshot: legacy.toSnapshot(),
      now,
    }).toSnapshot()
    if (!migrated.legacySource) {
      throw new Error('Expected preserved legacy source')
    }
    const corrupted = {
      ...migrated,
      legacySource: {
        ...migrated.legacySource,
        snapshot: {
          ...migrated.legacySource.snapshot,
          schemaVersion: 9,
          bankId: placementBankV1.id,
        },
      },
    }

    expect(() =>
      parseVocabularyAssessmentRuntimeSnapshotV2(
        corrupted,
        vocabularyPlacementBankV2,
      ),
    ).toThrow('schemaVersion is unsupported')
  })
})
