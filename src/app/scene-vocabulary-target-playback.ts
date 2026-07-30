import type { ListeningSpeechPort } from '../features/listening/index.ts'

export type SceneVocabularySpeechPort = Pick<
  ListeningSpeechPort,
  'cancel' | 'speak'
>

export interface SceneVocabularyTargetPlaybackIntent {
  readonly intent: 'play-target-only'
  readonly text: string
  readonly locale: 'en-US'
}

export function playSceneVocabularyTarget(
  speech: SceneVocabularySpeechPort,
  intent: SceneVocabularyTargetPlaybackIntent,
): void {
  // Never widen this into sentence playback: R13-B permits only the target.
  speech.cancel()
  speech.speak({ text: intent.text, locale: intent.locale, rate: 1 }, {})
}
