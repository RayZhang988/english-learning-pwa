export const travelVocabularyR1VisualFixtureIds = [
  'travel-r1-intro',
  'travel-r1-question',
  'travel-r1-review',
  'travel-r1-finish-confirmation',
  'travel-r1-stage-result',
  'travel-r1-resume',
  'travel-r1-migration',
  'travel-r1-results',
  'travel-r1-status',
] as const

export type TravelVocabularyR1VisualFixtureId =
  (typeof travelVocabularyR1VisualFixtureIds)[number]

export const uiVisualFixtureIds = [
  'today-task-request',
  'r3-training-completion',
  'r3-daily-duration-summary',
  'r6-daily-complete',
  'r6-extra-training-picker',
  'r6-extra-training-active',
  'r6-extra-training-complete',
  'assessment-intro',
  'assessment-choice',
  'assessment-feedback',
  'assessment-speech-fallback',
  'assessment-paused',
  'assessment-results',
  'vocabulary',
  'listening',
  'listening-dictation',
  'speaking',
  'progress',
  'permission',
  ...travelVocabularyR1VisualFixtureIds,
] as const

export type UiVisualFixtureId = (typeof uiVisualFixtureIds)[number]

export function isUiVisualFixtureId(
  value: string | null,
): value is UiVisualFixtureId {
  return uiVisualFixtureIds.some((id) => id === value)
}

export function isTravelVocabularyR1VisualFixtureId(
  value: UiVisualFixtureId,
): value is TravelVocabularyR1VisualFixtureId {
  return travelVocabularyR1VisualFixtureIds.some(
    (id) => id === value,
  )
}
