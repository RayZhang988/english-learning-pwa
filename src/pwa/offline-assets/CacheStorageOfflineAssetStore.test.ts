import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  NamespaceStore,
  StoredRecord,
} from '../../storage/contracts.ts'
import { CacheStorageOfflineAssetStore } from './CacheStorageOfflineAssetStore.ts'
import type { OfflinePackageRecord } from './contracts.ts'

class MemoryNamespaceStore implements NamespaceStore {
  private readonly records = new Map<string, StoredRecord<unknown>>()

  async get<T>(key: string): Promise<StoredRecord<T> | undefined> {
    return this.records.get(key) as StoredRecord<T> | undefined
  }

  async put<T>(key: string, value: T, schemaVersion = 1): Promise<void> {
    this.records.set(key, {
      namespace: 'test',
      key,
      value,
      schemaVersion,
      updatedAt: new Date().toISOString(),
    })
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key)
  }

  async keys(): Promise<readonly string[]> {
    return [...this.records.keys()]
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}

function installFakeCacheStorage() {
  const stores = new Map<string, Map<string, Response>>()

  const cacheStorage = {
    async open(name: string) {
      let entries = stores.get(name)
      if (!entries) {
        entries = new Map()
        stores.set(name, entries)
      }

      return {
        async put(request: Request, response: Response) {
          entries.set(request.url, response.clone())
        },
        async match(request: Request) {
          return entries.get(request.url)?.clone()
        },
      }
    },
    async delete(name: string) {
      return stores.delete(name)
    },
  }

  vi.stubGlobal('caches', cacheStorage)
  vi.stubGlobal('location', new URL('https://example.test/app/'))

  return stores
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CacheStorageOfflineAssetStore', () => {
  it('publishes a package only after every asset is cached', async () => {
    const stores = installFakeCacheStorage()
    const registry = new MemoryNamespaceStore()
    const store = new CacheStorageOfflineAssetStore(registry)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('lesson'))
      .mockResolvedValueOnce(new Response('audio'))
    vi.stubGlobal('fetch', fetchMock)

    const record = await store.install({
      packageId: 'week-01',
      version: '1',
      assets: [
        { url: './content/week-01.json', revision: 'a' },
        { url: './content/week-01.m4a', revision: 'b' },
      ],
    })

    expect(record.cacheName).toContain('week-01%401')
    expect(stores.has(record.cacheName)).toBe(true)
    await expect(store.getPackage('week-01')).resolves.toEqual(record)
    await expect(
      store
        .getAsset('week-01', './content/week-01.json')
        .then((response) => response?.text()),
    ).resolves.toBe('lesson')
  })

  it('keeps the previously installed package when replacement fails', async () => {
    const stores = installFakeCacheStorage()
    const registry = new MemoryNamespaceStore()
    const previous: OfflinePackageRecord = {
      packageId: 'week-01',
      version: '1',
      cacheName: 'existing-cache',
      installedAt: '2026-01-01T00:00:00.000Z',
      assets: [{ url: './old.json' }],
    }
    await registry.put('week-01', previous)
    stores.set(previous.cacheName, new Map())

    const store = new CacheStorageOfflineAssetStore(registry)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('new lesson'))
        .mockResolvedValueOnce(new Response(null, { status: 503 })),
    )

    const installation = store.install({
      packageId: 'week-01',
      version: '2',
      assets: [{ url: './new.json' }, { url: './new.m4a' }],
    })

    await expect(installation).rejects.toMatchObject({
      code: 'offline_asset_failed',
    })
    await expect(store.getPackage('week-01')).resolves.toEqual(previous)
    expect(stores.has(previous.cacheName)).toBe(true)
    expect(stores.size).toBe(1)
  })
})
