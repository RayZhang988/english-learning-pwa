import { placementBankV1 } from '../../../content/assessment/placement-bank.v1.ts'
import { vocabularyPlacementBankV2 } from '../../../content/assessment/placement-bank.v2.ts'
import { createTravelVocabularyAssessmentSessionR1 } from './travel-vocabulary-engine.ts'
import { parseAssessmentRuntimeSnapshot } from './snapshot.ts'
import { parseVocabularyAssessmentRuntimeSnapshotV2 } from './vocabulary-snapshot.ts'
import type {
  RandomSourceR1,
  TravelVocabularyAssessmentRuntimeSnapshotR1,
  TravelVocabularyBankR1,
} from './travel-vocabulary-types.ts'

function schemaVersion(value: unknown): number | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    typeof value.schemaVersion !== 'number'
  ) {
    return null
  }
  return value.schemaVersion
}

export function migrateLegacyAssessmentSnapshotToTravelR1(input: {
  readonly snapshot: unknown
  readonly bank: TravelVocabularyBankR1
  readonly random: RandomSourceR1
  readonly updatedAt: string
  readonly createId: () => string
  readonly recentWordIds?: readonly string[]
}): TravelVocabularyAssessmentRuntimeSnapshotR1 {
  const version = schemaVersion(input.snapshot)
  const legacySource =
    version === 1
      ? {
          kind: 'assessment-runtime-v1' as const,
          snapshot: parseAssessmentRuntimeSnapshot(
            input.snapshot,
            placementBankV1,
          ),
        }
      : version === 2
        ? {
            kind: 'adaptive-vocabulary-runtime-v2' as const,
            snapshot: parseVocabularyAssessmentRuntimeSnapshotV2(
              input.snapshot,
              vocabularyPlacementBankV2,
            ),
          }
        : null
  if (!legacySource) {
    throw new TypeError(
      `Unsupported legacy assessment snapshot version: ${String(version)}`,
    )
  }
  const session = createTravelVocabularyAssessmentSessionR1({
    id: input.createId(),
    startedAt: input.updatedAt,
    bank: input.bank,
    random: input.random,
    recentWordIds: input.recentWordIds,
  })
  return {
    schemaVersion: 3,
    assessmentKind: 'staged-travel-vocabulary',
    bankId: input.bank.id,
    lifecycle: 'intro',
    resumeTo: null,
    session,
    activeElapsedMs: 0,
    profile: null,
    legacySource,
    migrationNotice:
      'legacy-measurement-incompatible-new-sample-required',
    updatedAt: input.updatedAt,
  }
}
