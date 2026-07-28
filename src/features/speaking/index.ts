export {
  createSpeakingCatalog,
  resolveSpeakingTask,
} from './content.ts'
export {
  currentSpeakingContentSource,
  CurrentSpeakingContentSource,
  SPEAKING_CONTENT_PACKAGE_ID,
  SPEAKING_CONTENT_PACKAGE_VERSION,
} from './content-source.ts'
export {
  createSpeakingCompletedEvent,
  createSpeakingTaskPausedEvent,
  createSpeakingTaskSkippedEvent,
  createSpeakingTaskStartedEvent,
  createSpeakingUnscorableEvent,
} from './events.ts'
export {
  SpeakingError,
  toSpeakingError,
  type SpeakingErrorCode,
} from './errors.ts'
export { createSpeakingFeatureModule } from './feature-module.ts'
export {
  matchSpeakingText,
  normalizeSpeakingText,
} from './matching.ts'
export {
  BrowserSpeakingRecognition,
  browserSpeakingRecognition,
} from './recognition.ts'
export {
  BrowserSpeakingRecorder,
  browserSpeakingRecorder,
  getSpeakingRecordingCapabilities,
  supportedSpeakingMimeTypes,
} from './recording.ts'
export {
  SpeakingSessionRepository,
  SPEAKING_STORAGE_NAMESPACE,
  SPEAKING_STORAGE_SCHEMA_VERSION,
} from './repository.ts'
export {
  SpeakingRuntimeMountLifecycle,
  type SpeakingRuntimeDisposalPort,
} from './route-lifecycle.ts'
export {
  SpeakingTrainingRuntime,
  type SpeakingTrainingRuntimeOptions,
} from './runtime.ts'
export {
  advanceSpeakingSession,
  beginSpeakingRecording,
  createFailedSpeakingSession,
  createSpeakingSession,
  getCurrentSpeakingPrompt,
  getSpeakingSessionResult,
  markSpeakingCaptureUnavailable,
  pauseSpeakingSession,
  processSpeakingRecording,
  refreshSpeakingEnvironment,
  resumeSpeakingSession,
  retrySpeakingPrompt,
  submitSpeakingRecording,
  submitSpeakingWithoutRecording,
} from './session.ts'
export {
  SpeakingEffectiveTiming,
  type SpeakingEffectiveTimingSessionFactoryPort,
  type SpeakingEffectiveTimingSessionPort,
  type SpeakingTimingPhaseDeclaration,
} from './timing.ts'
export { SpeakingSessionScreen } from './SpeakingSessionScreen.tsx'
export {
  SpeakingTrainingRoute,
  type SpeakingTrainingRouteProps,
} from './SpeakingTrainingRoute.tsx'
export type {
  SpeakingActivityType,
  SpeakingAnswerRecord,
  SpeakingCatalog,
  SpeakingContentDocuments,
  SpeakingFallbackReason,
  SpeakingMatchLevel,
  SpeakingPrompt,
  SpeakingRecognitionCapabilities,
  SpeakingRecognitionErrorCode,
  SpeakingRecognitionHandle,
  SpeakingRecognitionOutcome,
  SpeakingRecognitionPort,
  SpeakingRecording,
  SpeakingRecordingCapabilities,
  SpeakingRecordingLifecycleCallbacks,
  SpeakingRecordingPort,
  SpeakingPlaybackLifecycleCallbacks,
  SpeakingSession,
  SpeakingSessionFailure,
  SpeakingSessionPhase,
  SpeakingSessionResult,
  SpeakingTextMatch,
  SpeakingTrainingUnit,
} from './types.ts'
export { toSpeakingScreenViewModel } from './view-model.ts'
