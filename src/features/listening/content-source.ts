import type { ReadonlyDataSource } from '../../core/index.ts'
import {
  offlineAssetStore,
  type OfflineAssetStore,
  type OfflinePackageRecord,
} from '../../pwa/index.ts'
import { createListeningCatalog } from './content.ts'
import { ListeningError } from './errors.ts'
import type {
  ListeningCatalog,
  ListeningContentDocuments,
} from './types.ts'

export const LISTENING_CONTENT_PACKAGE_ID =
  'content.survival-travel-american-4w.listening'
export const LISTENING_CONTENT_PACKAGE_VERSION = '1.0.0'

const PACKAGE_INDEX_PATH = 'content/curriculum/package-index.v1.json'
const EXTENSION_INDEX_PATH =
  'content/curriculum/listening-exercise-extension-index.v1.json'
const TRAINING_SUPPLY_INDEX_PATH =
  'content/curriculum/training-supply-index.v1.json'
const CURRENT_ASSET_URLS: Readonly<Record<string, string>> = {
  [PACKAGE_INDEX_PATH]: new URL(
    '../../../content/curriculum/package-index.v1.json',
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
  [EXTENSION_INDEX_PATH]: new URL(
    '../../../content/curriculum/listening-exercise-extension-index.v1.json',
    import.meta.url,
  ).href,
  'content/lessons/survival-travel-american-4w/listening-exercises.v1.json':
    new URL(
      '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json',
      import.meta.url,
    ).href,
  [TRAINING_SUPPLY_INDEX_PATH]: new URL(
    '../../../content/curriculum/training-supply-index.v1.json',
    import.meta.url,
  ).href,
}

interface CoreIndexShape {
  readonly manifestFile: string
  readonly lessonFiles: readonly string[]
  readonly trainingSupplyIndexFile: string | null
}

interface ExtensionIndexShape {
  readonly exerciseBundleFiles: readonly string[]
}

function stringFileList(
  value: unknown,
  singleKey: string | null,
  listKey: string,
  label: string,
): { readonly single?: string; readonly list: readonly string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ListeningError(
      'content-invalid',
      `${label} must be an object.`,
    )
  }
  const source = value as Record<string, unknown>
  const list = source[listKey]
  const single = singleKey ? source[singleKey] : undefined
  if (
    !Array.isArray(list) ||
    list.some((path) => typeof path !== 'string') ||
    (singleKey !== null && typeof single !== 'string')
  ) {
    throw new ListeningError(
      'content-invalid',
      `${label} has invalid file references.`,
    )
  }
  return {
    single: typeof single === 'string' ? single : undefined,
    list: list as readonly string[],
  }
}

function readCoreIndex(value: unknown): CoreIndexShape {
  const files = stringFileList(
    value,
    'manifestFile',
    'lessonFiles',
    'Core content package index',
  )
  return {
    manifestFile: files.single as string,
    lessonFiles: files.list,
    trainingSupplyIndexFile:
      typeof (value as Record<string, unknown>).trainingSupplyIndexFile === 'string'
        ? (value as Record<string, unknown>).trainingSupplyIndexFile as string
        : null,
  }
}

function readExtensionIndex(value: unknown): ExtensionIndexShape {
  return {
    exerciseBundleFiles: stringFileList(
      value,
      null,
      'exerciseBundleFiles',
      'Listening exercise extension index',
    ).list,
  }
}

export class CurrentListeningContentSource
  implements ReadonlyDataSource<ListeningCatalog>
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
      throw new ListeningError(
        'content-reference-missing',
        `The released listening package references an unbundled file: ${path}`,
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
      LISTENING_CONTENT_PACKAGE_ID,
      url,
    )
    if (!response) {
      try {
        response = await this.fetcher(url, { signal })
      } catch (error) {
        throw new ListeningError(
          'content-unavailable',
          `Unable to load listening content asset ${path}.`,
          { cause: error },
        )
      }
    }
    if (!response.ok) {
      throw new ListeningError(
        'content-unavailable',
        `Listening content asset ${path} returned ${response.status}.`,
      )
    }
    try {
      return await response.json()
    } catch (error) {
      throw new ListeningError(
        'content-invalid',
        `Listening content asset ${path} is not valid JSON.`,
        { cause: error },
      )
    }
  }

  async load(signal?: AbortSignal): Promise<ListeningCatalog> {
    const packageIndex = await this.readJson(PACKAGE_INDEX_PATH, signal)
    const coreFiles = readCoreIndex(packageIndex)
    const manifest = await this.readJson(coreFiles.manifestFile, signal)
    const lessonsByPath: Record<string, unknown> = {}
    for (const path of coreFiles.lessonFiles) {
      lessonsByPath[path] = await this.readJson(path, signal)
    }

    const extensionIndex = await this.readJson(
      EXTENSION_INDEX_PATH,
      signal,
    )
    const extensionFiles = readExtensionIndex(extensionIndex)
    const exerciseBundlesByPath: Record<string, unknown> = {}
    for (const path of extensionFiles.exerciseBundleFiles) {
      exerciseBundlesByPath[path] = await this.readJson(path, signal)
    }
    const trainingSupplyIndex = coreFiles.trainingSupplyIndexFile
      ? await this.readJson(coreFiles.trainingSupplyIndexFile, signal)
      : undefined

    const documents: ListeningContentDocuments = {
      packageIndex,
      manifest,
      lessonsByPath,
      extensionIndex,
      exerciseBundlesByPath,
      trainingSupplyIndex,
    }
    return createListeningCatalog(documents)
  }

  install(signal?: AbortSignal): Promise<OfflinePackageRecord> {
    return this.assets.install(
      {
        packageId: LISTENING_CONTENT_PACKAGE_ID,
        version: LISTENING_CONTENT_PACKAGE_VERSION,
        assets: Object.values(CURRENT_ASSET_URLS).map((url) => ({
          url,
          revision: LISTENING_CONTENT_PACKAGE_VERSION,
        })),
      },
      signal,
    )
  }
}

export const currentListeningContentSource =
  new CurrentListeningContentSource()
