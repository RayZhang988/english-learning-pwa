import Dexie, { type EntityTable } from 'dexie'

export interface DatabaseRecord {
  readonly id: string
  readonly namespace: string
  readonly key: string
  readonly value: unknown
  readonly schemaVersion: number
  readonly updatedAt: string
}

export class AppDatabase extends Dexie {
  records!: EntityTable<DatabaseRecord, 'id'>

  constructor(databaseName = 'english-learning-pwa') {
    super(databaseName)

    this.version(1).stores({
      records: '&id, namespace, [namespace+key], updatedAt',
    })
  }
}

export const appDatabase = new AppDatabase()
