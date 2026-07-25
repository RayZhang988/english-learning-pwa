import type { PortableValue } from '../portable-value.ts'

export interface DataMigration {
  readonly fromVersion: number
  readonly toVersion: number
  migrate(value: PortableValue): PortableValue
}

export interface DataMigrationPlan {
  readonly currentVersion: number
  readonly migrations: readonly DataMigration[]
}
