import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './AppDatabase.ts'
import { DexieStorageService } from './DexieStorageService.ts'

const databases: AppDatabase[] = []

function createStorage() {
  const database = new AppDatabase(`test-${crypto.randomUUID()}`)
  databases.push(database)
  return new DexieStorageService(database)
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close()
      await database.delete()
    }),
  )
})

describe('DexieStorageService', () => {
  it('keeps records isolated by namespace', async () => {
    const storage = createStorage()
    const vocabulary = storage.namespace('feature.vocabulary')
    const listening = storage.namespace('feature.listening')

    await vocabulary.put('session', { count: 3 })
    await listening.put('session', { count: 8 })

    await expect(vocabulary.get<{ count: number }>('session')).resolves.toMatchObject(
      {
        value: { count: 3 },
        schemaVersion: 1,
      },
    )
    await expect(listening.get<{ count: number }>('session')).resolves.toMatchObject(
      {
        value: { count: 8 },
      },
    )
  })

  it('clears only the selected namespace', async () => {
    const storage = createStorage()
    const first = storage.namespace('first')
    const second = storage.namespace('second')

    await first.put('one', true)
    await second.put('two', true)
    await first.clear()

    await expect(first.keys()).resolves.toEqual([])
    await expect(second.keys()).resolves.toEqual(['two'])
  })

  it('rejects values that cannot survive a JSON backup', async () => {
    const storage = createStorage()
    const feature = storage.namespace('feature.test')

    await expect(feature.put('date', new Date())).rejects.toThrow(
      'non-plain object',
    )
    await expect(
      feature.put('undefined', { valid: true, missing: undefined }),
    ).rejects.toThrow('not JSON-portable')
  })
})
