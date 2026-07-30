import type { ReadonlyDataSource } from '../core/index.ts'
import {
  offlineAssetStore,
  type OfflineAssetStore,
  type OfflinePackageRecord,
} from '../pwa/index.ts'
import { platformFetch } from '../platform/index.ts'
import {
  createSceneVocabularyQuestionBank,
  type SceneVocabularyQuestionBank,
  VocabularyError,
} from '../features/vocabulary/index.ts'

export const SCENE_VOCABULARY_CONTENT_PACKAGE_ID =
  'content.r13b-scene-vocabulary'
export const SCENE_VOCABULARY_CONTENT_PACKAGE_VERSION = '1.0.0'

const SCENE_VOCABULARY_QUESTION_BANK_PATH =
  'content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json'

const sceneVocabularyQuestionBankUrl = new URL(
  '../../content/lessons/survival-travel-american-4w/scene-vocabulary-questions.v1.json',
  import.meta.url,
).href

/**
 * The scene bank is intentionally separate from the daily vocabulary catalog.
 * It shares the PWA asset mechanism but never reads or writes plan state.
 */
export class CurrentSceneVocabularyContentSource
  implements ReadonlyDataSource<SceneVocabularyQuestionBank>
{
  private readonly assets: OfflineAssetStore
  private readonly fetcher: typeof fetch

  constructor(
    assets: OfflineAssetStore = offlineAssetStore,
    fetcher: typeof fetch = platformFetch,
  ) {
    this.assets = assets
    this.fetcher = fetcher
  }

  async load(signal?: AbortSignal): Promise<SceneVocabularyQuestionBank> {
    let response = await this.assets.getAsset(
      SCENE_VOCABULARY_CONTENT_PACKAGE_ID,
      sceneVocabularyQuestionBankUrl,
    )
    if (!response) {
      try {
        response = await this.fetcher(sceneVocabularyQuestionBankUrl, { signal })
      } catch (error) {
        throw new VocabularyError(
          'content-unavailable',
          `Unable to load scene vocabulary asset ${SCENE_VOCABULARY_QUESTION_BANK_PATH}.`,
          { cause: error },
        )
      }
    }
    if (!response.ok) {
      throw new VocabularyError(
        'content-unavailable',
        `Scene vocabulary asset ${SCENE_VOCABULARY_QUESTION_BANK_PATH} returned ${response.status}.`,
      )
    }
    try {
      return createSceneVocabularyQuestionBank(await response.json())
    } catch (error) {
      if (error instanceof VocabularyError) {
        throw error
      }
      throw new VocabularyError(
        'content-invalid',
        `Scene vocabulary asset ${SCENE_VOCABULARY_QUESTION_BANK_PATH} is not valid JSON.`,
        { cause: error },
      )
    }
  }

  install(signal?: AbortSignal): Promise<OfflinePackageRecord> {
    return this.assets.install(
      {
        packageId: SCENE_VOCABULARY_CONTENT_PACKAGE_ID,
        version: SCENE_VOCABULARY_CONTENT_PACKAGE_VERSION,
        assets: [
          {
            url: sceneVocabularyQuestionBankUrl,
            revision: SCENE_VOCABULARY_CONTENT_PACKAGE_VERSION,
          },
        ],
      },
      signal,
    )
  }
}

export const sceneVocabularyContentSource =
  new CurrentSceneVocabularyContentSource()
