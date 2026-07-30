/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type {
  OfflineAssetStore,
  OfflinePackageManifest,
  OfflinePackageRecord,
} from '../pwa/index.ts'
import {
  CurrentSceneVocabularyContentSource,
  SCENE_VOCABULARY_CONTENT_PACKAGE_ID,
  SCENE_VOCABULARY_CONTENT_PACKAGE_VERSION,
} from './scene-vocabulary-content-source.ts'

class FileBackedOfflineStore implements OfflineAssetStore {
  installedManifest: OfflinePackageManifest | undefined

  async install(manifest: OfflinePackageManifest): Promise<OfflinePackageRecord> {
    this.installedManifest = manifest
    return { ...manifest, cacheName: 'scene-vocabulary-test', installedAt: '2026-07-30T00:00:00.000Z' }
  }

  async getPackage(): Promise<OfflinePackageRecord | undefined> {
    return undefined
  }

  async getAsset(_packageId: string, url: string): Promise<Response> {
    return new Response(await readFile(new URL(url)), { status: 200 })
  }

  async remove(): Promise<void> {}
}

describe('released scene vocabulary content source', () => {
  it('loads the 18 published scenes from the local offline asset and installs only its own package', async () => {
    const store = new FileBackedOfflineStore()
    const source = new CurrentSceneVocabularyContentSource(
      store,
      (async () => {
        throw new Error('network must not be used when the offline asset exists')
      }) as typeof fetch,
    )

    const bank = await source.load()
    const installed = await source.install()

    expect(bank.scenes).toHaveLength(18)
    expect(bank.scenes.flatMap((scene) => scene.questions)).toHaveLength(108)
    expect(installed).toMatchObject({
      packageId: SCENE_VOCABULARY_CONTENT_PACKAGE_ID,
      version: SCENE_VOCABULARY_CONTENT_PACKAGE_VERSION,
    })
    expect(installed.assets).toHaveLength(1)
    expect(installed.assets[0]?.url).toMatch(/scene-vocabulary-questions\.v1\.json$/u)
  })
})
