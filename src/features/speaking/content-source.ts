import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  offlineAssetStore,
  type OfflineAssetStore,
  type OfflinePackageRecord,
} from '../../pwa/index.ts'
import { createSpeakingCatalog } from './content.ts'
import { SpeakingError } from './errors.ts'
import { loadReleasedTrainingSupplyIndex } from '../../app/training-supply-index.ts'
import type {
  SpeakingCatalog,
  SpeakingContentDocuments,
} from './types.ts'

export const SPEAKING_CONTENT_PACKAGE_ID =
  'content.survival-travel-american-4w.speaking'
export const SPEAKING_CONTENT_PACKAGE_VERSION = '1.0.0'

const PACKAGE_INDEX_PATH = 'content/curriculum/package-index.v1.json'
const CURRENT_ASSET_URLS: Readonly<Record<string, string>> = {
  [PACKAGE_INDEX_PATH]: new URL(
    '../../../content/curriculum/package-index.v1.json',
    import.meta.url,
  ).href,
  'content/curriculum/training-supply-index.v1.json': new URL(
    '../../../content/curriculum/training-supply-index.v1.json',
    import.meta.url,
  ).href,
  'content/curriculum/training-supply-index.v1/speaking.json': new URL(
    '../../../content/curriculum/training-supply-index.v1/speaking.json',
    import.meta.url,
  ).href,
  'content/curriculum/survival-travel-american-4w.v1.json': new URL(
    '../../../content/curriculum/survival-travel-american-4w.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-1.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-1.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-2.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-2.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-3.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-3.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/week-4.v1.json': new URL(
    '../../../content/lessons/survival-travel-american-4w/week-4.v1.json',
    import.meta.url,
  ).href,
}

interface PackageIndexShape {
  readonly manifestFile: string
  readonly lessonFiles: readonly string[]
  readonly trainingSupplyIndexFile?: string
}

function readPackageIndex(value: unknown): PackageIndexShape {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new SpeakingError(
      'content-invalid',
      'Speaking content package index must be an object.',
    )
  }
  const source = value as Record<string, unknown>
  if (
    typeof source.manifestFile !== 'string' ||
    !Array.isArray(source.lessonFiles) ||
    source.lessonFiles.some((path) => typeof path !== 'string')
  ) {
    throw new SpeakingError(
      'content-invalid',
      'Speaking content package index has invalid file references.',
    )
  }
  return {
    manifestFile: source.manifestFile,
    lessonFiles: source.lessonFiles as readonly string[],
    trainingSupplyIndexFile:
      typeof source.trainingSupplyIndexFile === 'string'
        ? source.trainingSupplyIndexFile
        : undefined,
  }
}

export class CurrentSpeakingContentSource
  implements ReadonlyDataSource<SpeakingCatalog>
{
  private readonly assets: OfflineAssetStore
  private readonly fetcher: typeof fetch

  constructor(
    assets: OfflineAssetStore = offlineAssetStore,
    fetcher: typeof fetch = fetch,
  ) {
    this.assets = assets
    this.fetcher = fetcher
  }

  private assetUrl(path: string): string {
    const url = CURRENT_ASSET_URLS[path]
    if (!url) {
      throw new SpeakingError(
        'content-reference-missing',
        `The released speaking package references an unbundled file: ${path}`,
      )
    }
    return url
  }

  private async readJson(
    path: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = this.assetUrl(path)
    let response = await this.assets.getAsset(
      SPEAKING_CONTENT_PACKAGE_ID,
      url,
    )
    if (!response) {
      try {
        response = await this.fetcher(url, { signal })
      } catch (error) {
        throw new SpeakingError(
          'content-unavailable',
          `Unable to load speaking content asset ${path}.`,
          { cause: error },
        )
      }
    }
    if (!response.ok) {
      throw new SpeakingError(
        'content-unavailable',
        `Speaking content asset ${path} returned ${response.status}.`,
      )
    }
    try {
      return await response.json()
    } catch (error) {
      throw new SpeakingError(
        'content-invalid',
        `Speaking content asset ${path} is not valid JSON.`,
        { cause: error },
      )
    }
  }

  async load(signal?: AbortSignal): Promise<SpeakingCatalog> {
    const packageIndex = await this.readJson(PACKAGE_INDEX_PATH, signal)
    const files = readPackageIndex(packageIndex)
    const manifest = await this.readJson(files.manifestFile, signal)
    const trainingSupplyIndex = files.trainingSupplyIndexFile
      ? await loadReleasedTrainingSupplyIndex(
        files.trainingSupplyIndexFile,
        'speaking',
        (path) => this.readJson(path, signal),
      )
      : undefined
    const lessonsByPath: Record<string, unknown> = {}
    for (const path of files.lessonFiles) {
      lessonsByPath[path] = await this.readJson(path, signal)
    }
    const documents: SpeakingContentDocuments = {
      packageIndex,
      manifest,
      lessonsByPath,
      trainingSupplyIndex,
    }
    return createSpeakingCatalog(documents)
  }

  install(signal?: AbortSignal): Promise<OfflinePackageRecord> {
    return this.assets.install(
      {
        packageId: SPEAKING_CONTENT_PACKAGE_ID,
        version: SPEAKING_CONTENT_PACKAGE_VERSION,
        assets: Object.values(CURRENT_ASSET_URLS).map((url) => ({
          url,
          revision: SPEAKING_CONTENT_PACKAGE_VERSION,
        })),
      },
      signal,
    )
  }
}

export const currentSpeakingContentSource =
  new CurrentSpeakingContentSource()
