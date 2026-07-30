/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type {
  OfflineAssetStore,
  OfflinePackageManifest,
  OfflinePackageRecord,
} from '../../pwa/index.ts'
import {
  CurrentListeningContentSource,
  LISTENING_CONTENT_PACKAGE_ID,
  LISTENING_CONTENT_PACKAGE_VERSION,
} from './content-source.ts'

class FileBackedOfflineStore implements OfflineAssetStore {
  installedManifest: OfflinePackageManifest | null = null

  async install(
    manifest: OfflinePackageManifest,
  ): Promise<OfflinePackageRecord> {
    this.installedManifest = manifest
    return {
      ...manifest,
      cacheName: 'listening-test-cache',
      installedAt: '2026-07-24T00:00:00.000Z',
    }
  }

  async getPackage(): Promise<OfflinePackageRecord | undefined> {
    return undefined
  }

  async getAsset(
    _packageId: string,
    url: string,
  ): Promise<Response | undefined> {
    return new Response(await readFile(new URL(url)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  async remove(): Promise<void> {}
}

describe('current listening content source', () => {
  it('loads core and extension data from the explicit offline store', async () => {
    const store = new FileBackedOfflineStore()
    const failNetwork = (async () => {
      throw new Error('network must not be used')
    }) as typeof fetch
    const source = new CurrentListeningContentSource(store, failNetwork)

    const catalog = await source.load()

    expect(catalog.units).toHaveLength(28)
    expect(catalog.units[0].questions).toHaveLength(9)
  })

  it('installs the ten runtime JSON assets needed for offline bilingual continuous training', async () => {
    const store = new FileBackedOfflineStore()
    const source = new CurrentListeningContentSource(store)

    const installed = await source.install()

    expect(installed.packageId).toBe(LISTENING_CONTENT_PACKAGE_ID)
    expect(installed.version).toBe(LISTENING_CONTENT_PACKAGE_VERSION)
    expect(installed.assets).toHaveLength(10)
    expect(new Set(installed.assets.map((asset) => asset.url)).size).toBe(10)
  })
})
