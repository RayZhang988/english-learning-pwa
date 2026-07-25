import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../core/errors/AppError.ts'
import type { NamespaceStore, StoredRecord } from '../contracts.ts'
import type { PortableValue } from '../portable-value.ts'
import {
  migratePortableValue,
  readMigratedRecord,
} from './migrate-record.ts'

function createMemoryStore(
  initial?: StoredRecord<PortableValue>,
): NamespaceStore & { readonly putMock: ReturnType<typeof vi.fn> } {
  let record = initial
  const putMock = vi.fn()

  return {
    async get<T>() {
      return record as StoredRecord<T> | undefined
    },
    async put<T>(key: string, value: T, schemaVersion = 1) {
      await putMock(key, value, schemaVersion)
      record = {
        namespace: 'feature.fixture',
        key,
        value: value as PortableValue,
        schemaVersion,
        updatedAt: new Date().toISOString(),
      }
    },
    putMock,
    async delete() {
      record = undefined
    },
    async keys() {
      return record ? [record.key] : []
    },
    async clear() {
      record = undefined
    },
  }
}

describe('migratePortableValue', () => {
  it('applies every contiguous migration in order', () => {
    const result = migratePortableValue({ count: 1 }, 1, {
      currentVersion: 3,
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          migrate(value) {
            return { ...(value as { count: number }), label: 'ready' }
          },
        },
        {
          fromVersion: 2,
          toVersion: 3,
          migrate(value) {
            return { ...(value as object), enabled: true }
          },
        },
      ],
    })

    expect(result).toEqual({
      schemaVersion: 3,
      value: { count: 1, label: 'ready', enabled: true },
    })
  })

  it('rejects records written by a newer schema', () => {
    try {
      migratePortableValue({}, 4, {
        currentVersion: 3,
        migrations: [],
      })
      throw new Error('Expected a schema incompatibility error')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('schema_incompatible')
    }
  })

  it('rejects a migration chain with a missing step', () => {
    expect(() =>
      migratePortableValue({}, 1, {
        currentVersion: 3,
        migrations: [
          {
            fromVersion: 2,
            toVersion: 3,
            migrate: (value) => value,
          },
        ],
      }),
    ).toThrow('Missing migration from version 1')
  })
})

describe('readMigratedRecord', () => {
  it('writes an upgraded value back before returning it', async () => {
    const store = createMemoryStore({
      namespace: 'feature.fixture',
      key: 'progress',
      value: { completed: 2 },
      schemaVersion: 1,
      updatedAt: '2026-07-24T00:00:00.000Z',
    })

    const record = await readMigratedRecord(store, 'progress', {
      currentVersion: 2,
      migrations: [
        {
          fromVersion: 1,
          toVersion: 2,
          migrate(value) {
            return { ...(value as object), streak: 0 }
          },
        },
      ],
    })

    expect(store.putMock).toHaveBeenCalledWith(
      'progress',
      { completed: 2, streak: 0 },
      2,
    )
    expect(record).toMatchObject({
      schemaVersion: 2,
      value: { completed: 2, streak: 0 },
    })
  })
})
