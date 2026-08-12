import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  offlineAssetStore,
  type OfflineAssetStore,
  type OfflinePackageRecord,
} from '../../pwa/index.ts'
import { createVocabularyCatalog } from './content.ts'
import { VocabularyError } from './errors.ts'
import { loadReleasedTrainingSupplyIndex } from '../../app/training-supply-index.ts'
import type {
  VocabularyCatalog,
  VocabularyContentDocuments,
} from './types.ts'

export const VOCABULARY_CONTENT_PACKAGE_ID =
  'content.survival-travel-american-4w'
export const VOCABULARY_CONTENT_PACKAGE_VERSION = '1.0.0'

const PACKAGE_INDEX_PATH = 'content/curriculum/package-index.v1.json'
const SUPPLY_SHARD_ASSET_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Array.from({ length: 16 }, (_, bucket) => {
    const suffix = String(bucket).padStart(2, '0')
    const path = `content/curriculum/training-supply-index.v1/vocabulary-${suffix}.json`
    return [path, new URL(`../../../content/curriculum/training-supply-index.v1/vocabulary-${suffix}.json`, import.meta.url).href]
  }),
)
const CURRENT_PACKAGE_ASSET_URLS: Readonly<Record<string, string>> = {
  [PACKAGE_INDEX_PATH]: new URL(
    '../../../content/curriculum/package-index.v1.json',
    import.meta.url,
  ).href,
  'content/curriculum/survival-travel-american-4w.v1.json': new URL(
    '../../../content/curriculum/survival-travel-american-4w.v1.json',
    import.meta.url,
  ).href,
  'content/curriculum/training-supply-index.v1.json': new URL(
    '../../../content/curriculum/training-supply-index.v1.json',
    import.meta.url,
  ).href,
  ...SUPPLY_SHARD_ASSET_URLS,
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
  readonly trainingSupplyIndexFile: string | null
}

function readPackageIndexShape(value: unknown): PackageIndexShape {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VocabularyError(
      'content-invalid',
      'Content package index must be an object.',
    )
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.manifestFile !== 'string' ||
    !Array.isArray(record.lessonFiles) ||
    record.lessonFiles.some((path) => typeof path !== 'string')
  ) {
    throw new VocabularyError(
      'content-invalid',
      'Content package index has invalid file references.',
    )
  }
  if (
    record.trainingSupplyIndexFile !== undefined &&
    typeof record.trainingSupplyIndexFile !== 'string'
  ) {
    throw new VocabularyError(
      'content-invalid',
      'Content package index has an invalid training supply reference.',
    )
  }
  return {
    manifestFile: record.manifestFile,
    lessonFiles: record.lessonFiles as readonly string[],
    trainingSupplyIndexFile:
      typeof record.trainingSupplyIndexFile === 'string'
        ? record.trainingSupplyIndexFile
        : null,
  }
}

export class CurrentVocabularyContentSource
  implements ReadonlyDataSource<VocabularyCatalog>
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
    const url = CURRENT_PACKAGE_ASSET_URLS[path]
    if (!url) {
      throw new VocabularyError(
        'content-reference-missing',
        `The released package references an unbundled file: ${path}`,
      )
    }
    return url
  }

  private async readJson(path: string, signal?: AbortSignal): Promise<unknown> {
    const url = this.assetUrl(path)
    const cached = await this.assets.getAsset(
      VOCABULARY_CONTENT_PACKAGE_ID,
      url,
    )
    let response = cached
    if (!response) {
      try {
        response = await this.fetcher(url, { signal })
      } catch (error) {
        throw new VocabularyError(
          'content-unavailable',
          `Unable to load vocabulary content asset ${path}.`,
          { cause: error },
        )
      }
    }
    if (!response.ok) {
      throw new VocabularyError(
        'content-unavailable',
        `Vocabulary content asset ${path} returned ${response.status}.`,
      )
    }
    try {
      return await response.json()
    } catch (error) {
      throw new VocabularyError(
        'content-invalid',
        `Vocabulary content asset ${path} is not valid JSON.`,
        { cause: error },
      )
    }
  }

  async load(signal?: AbortSignal): Promise<VocabularyCatalog> {
    const packageIndex = await this.readJson(PACKAGE_INDEX_PATH, signal)
    const packageFiles = readPackageIndexShape(packageIndex)
    const manifest = await this.readJson(
      packageFiles.manifestFile,
      signal,
    )
    const lessonsByPath: Record<string, unknown> = {}

    for (const lessonFile of packageFiles.lessonFiles) {
      lessonsByPath[lessonFile] = await this.readJson(lessonFile, signal)
    }

    const documents: VocabularyContentDocuments = {
      packageIndex,
      manifest,
      lessonsByPath,
      trainingSupplyIndex: packageFiles.trainingSupplyIndexFile
        ? await loadReleasedTrainingSupplyIndex(
          packageFiles.trainingSupplyIndexFile,
          'vocabulary',
          (path) => this.readJson(path, signal),
        )
        : undefined,
    }
    return createVocabularyCatalog(documents)
  }

  install(signal?: AbortSignal): Promise<OfflinePackageRecord> {
    return this.assets.install(
      {
        packageId: VOCABULARY_CONTENT_PACKAGE_ID,
        version: VOCABULARY_CONTENT_PACKAGE_VERSION,
        assets: Object.values(CURRENT_PACKAGE_ASSET_URLS).map((url) => ({
          url,
          revision: VOCABULARY_CONTENT_PACKAGE_VERSION,
        })),
      },
      signal,
    )
  }
}

export const currentVocabularyContentSource =
  new CurrentVocabularyContentSource()
