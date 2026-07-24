import { AppError } from '../../core/errors/AppError.ts'
import { localStorageService } from '../../storage/indexed-db/DexieStorageService.ts'
import type { NamespaceStore } from '../../storage/contracts.ts'
import type {
  OfflineAssetStore,
  OfflinePackageManifest,
  OfflinePackageRecord,
} from './contracts.ts'

const cachePrefix = 'english-learning-content'
const registry = localStorageService.namespace('pwa.offline-packages')

function validateManifest(manifest: OfflinePackageManifest) {
  if (!manifest.packageId || !manifest.version || manifest.assets.length === 0) {
    throw new TypeError('Offline package manifest is incomplete')
  }

  const urls = new Set(manifest.assets.map((asset) => asset.url))
  if (urls.size !== manifest.assets.length) {
    throw new TypeError('Offline package contains duplicate asset URLs')
  }
}

function cacheNameFor(manifest: OfflinePackageManifest) {
  const identity = encodeURIComponent(`${manifest.packageId}@${manifest.version}`)
  const installationId = crypto.randomUUID()
  return `${cachePrefix}:${identity}:${installationId}`
}

function resolveAssetUrl(url: string) {
  return new URL(url, globalThis.location?.href ?? 'http://localhost/').href
}

export class CacheStorageOfflineAssetStore implements OfflineAssetStore {
  private readonly packageRegistry: NamespaceStore

  constructor(packageRegistry: NamespaceStore = registry) {
    this.packageRegistry = packageRegistry
  }

  async install(
    manifest: OfflinePackageManifest,
    signal?: AbortSignal,
  ): Promise<OfflinePackageRecord> {
    validateManifest(manifest)

    if (!('caches' in globalThis)) {
      throw new AppError(
        'offline_asset_failed',
        '当前浏览器不支持离线资源缓存。',
      )
    }

    const cacheName = cacheNameFor(manifest)
    const previous = await this.getPackage(manifest.packageId)

    try {
      const cache = await caches.open(cacheName)

      for (const asset of manifest.assets) {
        const canonicalUrl = resolveAssetUrl(asset.url)
        const requestUrl = new URL(canonicalUrl)
        if (asset.revision) {
          requestUrl.searchParams.set('__revision', asset.revision)
        }

        const response = await fetch(requestUrl, {
          cache: 'no-store',
          signal,
        })

        if (!response.ok) {
          throw new Error(`Asset request failed with ${response.status}`)
        }

        await cache.put(new Request(canonicalUrl), response)
      }

      const record: OfflinePackageRecord = {
        ...manifest,
        cacheName,
        installedAt: new Date().toISOString(),
      }

      await this.packageRegistry.put(manifest.packageId, record)

      if (previous && previous.cacheName !== cacheName) {
        await caches.delete(previous.cacheName)
      }

      return record
    } catch (error) {
      await caches.delete(cacheName)

      throw new AppError(
        'offline_asset_failed',
        `离线包 ${manifest.packageId} 下载失败。`,
        {
          cause: error,
          recoverable: true,
          details: {
            packageId: manifest.packageId,
            version: manifest.version,
          },
        },
      )
    }
  }

  async getPackage(
    packageId: string,
  ): Promise<OfflinePackageRecord | undefined> {
    const record =
      await this.packageRegistry.get<OfflinePackageRecord>(packageId)
    return record?.value
  }

  async getAsset(
    packageId: string,
    url: string,
  ): Promise<Response | undefined> {
    const record = await this.getPackage(packageId)
    if (!record) {
      return undefined
    }

    const cache = await caches.open(record.cacheName)
    return cache.match(new Request(resolveAssetUrl(url)))
  }

  async remove(packageId: string): Promise<void> {
    const record = await this.getPackage(packageId)
    if (!record) {
      return
    }

    await caches.delete(record.cacheName)
    await this.packageRegistry.delete(packageId)
  }
}

export const offlineAssetStore = new CacheStorageOfflineAssetStore()
