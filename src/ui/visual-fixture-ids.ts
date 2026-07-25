export const uiVisualFixtureIds = [
  'today-task-request',
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
] as const

export type UiVisualFixtureId = (typeof uiVisualFixtureIds)[number]

export function isUiVisualFixtureId(
  value: string | null,
): value is UiVisualFixtureId {
  return uiVisualFixtureIds.some((id) => id === value)
}
