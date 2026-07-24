import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../indexed-db/AppDatabase.ts'
import { DexieStorageService } from '../indexed-db/DexieStorageService.ts'
import { DexieBackupService } from './DexieBackupService.ts'

const databases: AppDatabase[] = []

function createServices() {
  const database = new AppDatabase(`backup-test-${crypto.randomUUID()}`)
  databases.push(database)
  return {
    backup: new DexieBackupService(database),
    storage: new DexieStorageService(database),
  }
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (database) => {
      database.close()
      await database.delete()
    }),
  )
})

describe('DexieBackupService', () => {
  it('exports a deterministic, inspectable backup', async () => {
    const { backup, storage } = createServices()
    await storage.namespace('zeta').put('second', { value: 2 }, 2)
    await storage.namespace('alpha').put('first', { value: 1 })
    await storage.namespace('pwa.offline-packages').put('week-01', {
      cacheName: 'device-local-cache',
    })

    const json = await backup.exportJson()
    const envelope = JSON.parse(json) as {
      records: { namespace: string }[]
    }

    expect(envelope.records.map((record) => record.namespace)).toEqual([
      'alpha',
      'zeta',
    ])
    expect(backup.inspectJson(json)).toMatchObject({
      recordCount: 2,
      namespaces: ['alpha', 'zeta'],
    })
  })

  it('supports explicit merge and replace restore modes', async () => {
    const source = createServices()
    await source.storage.namespace('feature.words').put('progress', {
      completed: 12,
    })
    const json = await source.backup.exportJson()

    const target = createServices()
    const targetWords = target.storage.namespace('feature.words')
    const unrelated = target.storage.namespace('feature.listening')
    await targetWords.put('progress', { completed: 1 })
    await unrelated.put('draft', { position: 30 })

    await target.backup.restoreJson(json, 'merge')
    await expect(targetWords.get('progress')).resolves.toMatchObject({
      value: { completed: 12 },
    })
    await expect(unrelated.get('draft')).resolves.toBeDefined()

    await unrelated.put('another', true)
    await target.backup.restoreJson(json, 'replace')
    await expect(unrelated.keys()).resolves.toEqual([])
    await expect(targetWords.get('progress')).resolves.toMatchObject({
      value: { completed: 12 },
    })
  })

  it('rejects invalid input before changing existing data', async () => {
    const { backup, storage } = createServices()
    const feature = storage.namespace('feature.words')
    await feature.put('progress', { completed: 4 })

    await expect(
      backup.restoreJson(
        JSON.stringify({
          format: 'english-learning-pwa-backup',
          formatVersion: 99,
          exportedAt: new Date().toISOString(),
          records: [],
        }),
        'replace',
      ),
    ).rejects.toMatchObject({
      code: 'backup_invalid',
    })

    await expect(feature.get('progress')).resolves.toMatchObject({
      value: { completed: 4 },
    })
  })
})
