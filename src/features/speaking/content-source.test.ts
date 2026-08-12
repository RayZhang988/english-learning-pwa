/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type {
  OfflineAssetStore,
  OfflinePackageManifest,
  OfflinePackageRecord,
} from '../../pwa/index.ts'
import {
  CurrentSpeakingContentSource,
  SPEAKING_CONTENT_PACKAGE_ID,
  SPEAKING_CONTENT_PACKAGE_VERSION,
} from './content-source.ts'

class FileBackedOfflineStore implements OfflineAssetStore {
  installedManifest: OfflinePackageManifest | null = null

  async install(
    manifest: OfflinePackageManifest,
  ): Promise<OfflinePackageRecord> {
    this.installedManifest = manifest
    return {
      ...manifest,
      cacheName: 'speaking-test-cache',
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

describe('current speaking content source', () => {
  it('loads the released package from the explicit offline store', async () => {
    const source = new CurrentSpeakingContentSource(
      new FileBackedOfflineStore(),
      (async () => {
        throw new Error('network must not be used')
      }) as typeof fetch,
    )

    const catalog = await source.load()

    expect(catalog.units).toHaveLength(28)
  })

  it('installs the six JSON files required for speaking practice', async () => {
    const source = new CurrentSpeakingContentSource(
      new FileBackedOfflineStore(),
    )

    const installed = await source.install()

    expect(installed.packageId).toBe(SPEAKING_CONTENT_PACKAGE_ID)
    expect(installed.version).toBe(SPEAKING_CONTENT_PACKAGE_VERSION)
    expect(installed.assets).toHaveLength(8)
  })
})
