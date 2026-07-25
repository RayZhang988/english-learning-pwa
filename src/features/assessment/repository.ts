import type { NamespaceStore } from '../../storage/index.ts'
import type { AbilityProfile } from './types.ts'

export const ASSESSMENT_STORAGE_NAMESPACE = 'feature.assessment'
export const ASSESSMENT_STORAGE_SCHEMA_VERSION = 1
export const LATEST_PROFILE_KEY = 'latest-ability-profile'

function assertAbilityProfile(value: unknown): asserts value is AbilityProfile {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('profileId' in value) ||
    typeof value.profileId !== 'string' ||
    !('abilities' in value) ||
    typeof value.abilities !== 'object' ||
    value.abilities === null
  ) {
    throw new TypeError('Stored assessment profile is invalid')
  }
}

export class AssessmentProfileRepository {
  readonly #store: NamespaceStore

  constructor(store: NamespaceStore) {
    this.#store = store
  }

  async saveLatest(profile: AbilityProfile): Promise<void> {
    await this.#store.put(
      LATEST_PROFILE_KEY,
      profile,
      ASSESSMENT_STORAGE_SCHEMA_VERSION,
    )
  }

  async loadLatest(): Promise<AbilityProfile | undefined> {
    const record = await this.#store.get<unknown>(LATEST_PROFILE_KEY)
    if (!record) {
      return undefined
    }
    if (record.schemaVersion !== ASSESSMENT_STORAGE_SCHEMA_VERSION) {
      throw new TypeError(
        `Unsupported assessment profile version: ${record.schemaVersion}`,
      )
    }
    assertAbilityProfile(record.value)
    return record.value
  }
}
