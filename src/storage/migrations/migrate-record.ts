import { AppError } from '../../core/errors/AppError.ts'
import type { NamespaceStore, StoredRecord } from '../contracts.ts'
import { assertPortableValue, type PortableValue } from '../portable-value.ts'
import type { DataMigrationPlan } from './contracts.ts'

function incompatible(message: string, details: Readonly<Record<string, unknown>>) {
  return new AppError('schema_incompatible', message, {
    recoverable: true,
    details,
  })
}

function assertPositiveVersion(version: number, label: string): void {
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`${label} must be a positive integer`)
  }
}

export function migratePortableValue(
  value: PortableValue,
  sourceVersion: number,
  plan: DataMigrationPlan,
): { readonly value: PortableValue; readonly schemaVersion: number } {
  assertPositiveVersion(sourceVersion, 'sourceVersion')
  assertPositiveVersion(plan.currentVersion, 'currentVersion')
  assertPortableValue(value)

  if (sourceVersion > plan.currentVersion) {
    throw incompatible(
      `Stored data version ${sourceVersion} is newer than supported version ${plan.currentVersion}.`,
      { sourceVersion, currentVersion: plan.currentVersion },
    )
  }

  const migrationsByVersion = new Map(
    plan.migrations.map((migration) => {
      assertPositiveVersion(migration.fromVersion, 'migration.fromVersion')
      assertPositiveVersion(migration.toVersion, 'migration.toVersion')

      if (migration.toVersion !== migration.fromVersion + 1) {
        throw new TypeError('Migrations must advance exactly one version')
      }

      return [migration.fromVersion, migration] as const
    }),
  )

  if (migrationsByVersion.size !== plan.migrations.length) {
    throw new TypeError('Migration plan contains duplicate source versions')
  }

  let migratedValue = value
  let version = sourceVersion

  while (version < plan.currentVersion) {
    const migration = migrationsByVersion.get(version)
    if (!migration) {
      throw incompatible(`Missing migration from version ${version}.`, {
        sourceVersion,
        currentVersion: plan.currentVersion,
        missingFromVersion: version,
      })
    }

    migratedValue = migration.migrate(migratedValue)
    assertPortableValue(migratedValue)
    version = migration.toVersion
  }

  return { value: migratedValue, schemaVersion: version }
}

/**
 * Reads one record, applies a deterministic migration chain, and persists the
 * upgraded portable value before returning it to the feature.
 */
export async function readMigratedRecord<TValue extends PortableValue>(
  store: NamespaceStore,
  key: string,
  plan: DataMigrationPlan,
): Promise<StoredRecord<TValue> | undefined> {
  const record = await store.get<PortableValue>(key)
  if (!record) {
    return undefined
  }

  const migrated = migratePortableValue(
    record.value,
    record.schemaVersion,
    plan,
  )

  if (migrated.schemaVersion !== record.schemaVersion) {
    await store.put(key, migrated.value, migrated.schemaVersion)
    return store.get<TValue>(key)
  }

  return {
    ...record,
    value: migrated.value as TValue,
    schemaVersion: migrated.schemaVersion,
  }
}
