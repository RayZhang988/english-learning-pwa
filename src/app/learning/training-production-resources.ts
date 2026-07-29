import {
  CurrentListeningContentSource,
} from '../../features/listening/index.ts'
import {
  CurrentSpeakingContentSource,
} from '../../features/speaking/index.ts'
import {
  CurrentVocabularyContentSource,
} from '../../features/vocabulary/index.ts'
import { platformFetch } from '../../platform/index.ts'
import { offlineAssetStore } from '../../pwa/index.ts'
import {
  createProductionTrainingSupplyProviders,
} from './training-supply-providers.ts'

/**
 * One offline-first production graph is shared by daily and optional routes.
 * Failed catalog loads remain retryable inside the source/provider adapters.
 */
export const vocabularyContentSource =
  new CurrentVocabularyContentSource(
    offlineAssetStore,
    platformFetch,
  )

export const listeningContentSource =
  new CurrentListeningContentSource(
    offlineAssetStore,
    platformFetch,
  )

export const speakingContentSource =
  new CurrentSpeakingContentSource(
    offlineAssetStore,
    platformFetch,
  )

export const trainingSupplyProviders =
  createProductionTrainingSupplyProviders({
    vocabulary: vocabularyContentSource,
    listening: listeningContentSource,
    speaking: speakingContentSource,
  })
