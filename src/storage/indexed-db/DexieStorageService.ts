import type {
  LocalStorageService,
  NamespaceStore,
  StoredRecord,
} from '../contracts.ts'
import { assertValidNamespace } from '../namespace.ts'
import { assertPortableValue } from '../portable-value.ts'
import { createRecordId } from '../record-id.ts'
import { toStorageError } from '../storage-error.ts'
import { appDatabase, type AppDatabase } from './AppDatabase.ts'

class DexieNamespaceStore implements NamespaceStore {
  private readonly database: AppDatabase
  private readonly namespaceName: string

  constructor(database: AppDatabase, namespaceName: string) {
    this.database = database
    this.namespaceName = namespaceName
  }

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    try {
      const record = await this.database.records.get(
        createRecordId(this.namespaceName, key),
      )

      if (!record) {
        return undefined
      }

      return {
        namespace: record.namespace,
        key: record.key,
        value: record.value as T,
        schemaVersion: record.schemaVersion,
        updatedAt: record.updatedAt,
      }
    } catch (error) {
      throw this.storageError(error)
    }
  }

  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> {
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new TypeError('schemaVersion must be a positive integer')
    }

    assertPortableValue(value)

    try {
      await this.database.records.put({
        id: createRecordId(this.namespaceName, key),
        namespace: this.namespaceName,
        key,
        value,
        schemaVersion,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      throw this.storageError(error)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.database.records.delete(
        createRecordId(this.namespaceName, key),
      )
    } catch (error) {
      throw this.storageError(error)
    }
  }

  async keys(): Promise<readonly string[]> {
    try {
      const records = await this.database.records
        .where('namespace')
        .equals(this.namespaceName)
        .toArray()

      return records.map((record) => record.key)
    } catch (error) {
      throw this.storageError(error)
    }
  }

  async clear(): Promise<void> {
    try {
      await this.database.records
        .where('namespace')
        .equals(this.namespaceName)
        .delete()
    } catch (error) {
      throw this.storageError(error)
    }
  }

  private storageError(error: unknown) {
    return toStorageError(error, {
      namespace: this.namespaceName,
    })
  }
}

export class DexieStorageService implements LocalStorageService {
  private readonly database: AppDatabase

  constructor(database: AppDatabase = appDatabase) {
    this.database = database
  }

  namespace(name: string): NamespaceStore {
    assertValidNamespace(name)
    return new DexieNamespaceStore(this.database, name)
  }
}

export const localStorageService = new DexieStorageService()
