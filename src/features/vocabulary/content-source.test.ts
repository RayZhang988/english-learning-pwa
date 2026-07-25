/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type {
  OfflineAssetStore,
  OfflinePackageManifest,
  OfflinePackageRecord,
} from '../../pwa/index.ts'
import {
  CurrentVocabularyContentSource,
  VOCABULARY_CONTENT_PACKAGE_ID,
  VOCABULARY_CONTENT_PACKAGE_VERSION,
} from './content-source.ts'

class FileBackedOfflineStore implements OfflineAssetStore {
  installedManifest: OfflinePackageManifest | null = null

  async install(
    manifest: OfflinePackageManifest,
  ): Promise<OfflinePackageRecord> {
    this.installedManifest = manifest
    return {
      ...manifest,
      cacheName: 'test-cache',
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
    const bytes = await readFile(new URL(url))
    return new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  async remove(): Promise<void> {}
}

describe('current vocabulary content source', () => {
  it('loads the released package entirely from the explicit offline store', async () => {
    const store = new FileBackedOfflineStore()
    const failNetwork = (async () => {
      throw new Error('network must not be used')
    }) as typeof fetch
    const source = new CurrentVocabularyContentSource(
      store,
      failNetwork,
    )

    const catalog = await source.load()

    expect(catalog.units).toHaveLength(28)
  })

  it('installs exactly the released index, manifest, and four lesson files', async () => {
    const store = new FileBackedOfflineStore()
    const source = new CurrentVocabularyContentSource(store)

    const installed = await source.install()

    expect(installed.packageId).toBe(VOCABULARY_CONTENT_PACKAGE_ID)
    expect(installed.version).toBe(VOCABULARY_CONTENT_PACKAGE_VERSION)
    expect(installed.assets).toHaveLength(6)
    expect(new Set(installed.assets.map((asset) => asset.url)).size).toBe(6)
  })
})
