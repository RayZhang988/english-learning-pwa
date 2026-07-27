import type { NamespaceStore } from '../../storage/index.ts'
import { LATEST_PROFILE_KEY } from './repository.ts'
import type { AbilityProfileV1 } from './types.ts'
import type {
  AbilityProfileV2,
  AnyAbilityProfile,
} from './vocabulary-types.ts'

export const VERSIONED_ASSESSMENT_PROFILE_STORAGE_SCHEMA_VERSION = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertV1(value: unknown): asserts value is AbilityProfileV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.profileId !== 'string' ||
    typeof value.assessmentId !== 'string' ||
    !isRecord(value.abilities)
  ) {
    throw new TypeError('Stored v1 assessment profile is invalid')
  }
}

function assertPendingDomain(
  value: unknown,
  domain: 'listening' | 'speaking',
): void {
  if (
    !isRecord(value) ||
    value.domain !== domain ||
    value.calibrationState !== 'pending-calibration' ||
    value.internalLevel !== null ||
    value.cefrEstimate !== 'unknown' ||
    value.confidence !== 0
  ) {
    throw new TypeError(
      `Stored v2 ${domain} estimate is not pending calibration`,
    )
  }
}

function assertV2(value: unknown): asserts value is AbilityProfileV2 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    value.assessmentKind !== 'adaptive-vocabulary' ||
    typeof value.profileId !== 'string' ||
    typeof value.assessmentId !== 'string' ||
    !isRecord(value.abilities) ||
    !isRecord(value.vocabularySize) ||
    value.vocabularySize.wordCountRange !== null ||
    value.vocabularySize.wordCountCalibration !== 'unavailable'
  ) {
    throw new TypeError('Stored v2 assessment profile is invalid')
  }
  assertPendingDomain(value.abilities.listening, 'listening')
  assertPendingDomain(value.abilities.speaking, 'speaking')
}

export function parseVersionedAbilityProfile(
  value: unknown,
): AnyAbilityProfile {
  if (isRecord(value) && value.schemaVersion === 1) {
    assertV1(value)
    return structuredClone(value)
  }
  assertV2(value)
  return structuredClone(value)
}

/**
 * 01 may use this adapter during migration. It reads v1 records without
 * rewriting them and writes v2 profiles using record schema 2.
 */
export class VersionedAssessmentProfileRepository {
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async saveLatest(profile: AnyAbilityProfile): Promise<void> {
    const validated = parseVersionedAbilityProfile(profile)
    await this.#store.put(
      LATEST_PROFILE_KEY,
      validated,
      validated.schemaVersion,
    )
  }

  async loadLatest(): Promise<AnyAbilityProfile | undefined> {
    const stored = await this.#store.get<unknown>(LATEST_PROFILE_KEY)
    if (!stored) {
      return undefined
    }
    if (stored.schemaVersion !== 1 && stored.schemaVersion !== 2) {
      throw new TypeError(
        `Unsupported assessment profile version: ${stored.schemaVersion}`,
      )
    }
    const profile = parseVersionedAbilityProfile(stored.value)
    if (profile.schemaVersion !== stored.schemaVersion) {
      throw new TypeError(
        'Assessment profile record version does not match its value',
      )
    }
    return profile
  }
}
