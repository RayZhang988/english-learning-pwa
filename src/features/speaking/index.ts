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
  createSpeakingStreamAttemptEvent,
  createSpeakingTrainingBudgetCompletedEvent,
  createSpeakingTrainingContentExhaustedEvent,
  createSpeakingTrainingContentRecoveredEvent,
  createSpeakingTrainingItemCompletedEvent,
} from './events.ts'
export { SpeakingCatalogSupplyProvider, resolveSpeakingSupplyPrompt, type SpeakingSupplyProvider } from './supply.ts'
export {
  SpeakingError,
  toSpeakingError,
  type SpeakingErrorCode,
} from './errors.ts'
export { createSpeakingFeatureModule } from './feature-module.ts'
export {
  createSpeakingGrowthUpgradeAdapter,
  type SpeakingGrowthUpgradeAdapter,
  type SpeakingGrowthUpgradePromptView,
  type SpeakingGrowthUpgradeSubmission,
} from './growth-upgrade.ts'
export {
  SpeakingGrowthUpgradeMediaSession,
  type SpeakingGrowthUpgradeMediaSessionOptions,
  type SpeakingGrowthUpgradeMediaStatus,
  type SpeakingGrowthUpgradeMediaView,
} from './growth-upgrade-media.ts'
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
  createSpeakingStreamSession,
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
  ExtraSpeakingTrainingRuntime,
  type ExtraSpeakingTrainingRuntimeOptions,
  type ExtraSpeakingTrainingSnapshot,
  type ExtraSpeakingSupplyProvider,
} from './extra-training.ts'
export {
  ExtraSpeakingTrainingRepository,
  EXTRA_SPEAKING_TRAINING_STORAGE_NAMESPACE,
} from './extra-training-repository.ts'
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
  SpeakingSupplyItem,
  SpeakingStreamState,
} from './types.ts'
export { toSpeakingScreenViewModel } from './view-model.ts'
export {
  SpeakingWrongAnswerContentResolver,
  SpeakingWrongAnswerReviewRuntime,
  advanceSpeakingWrongAnswerReview,
  applySpeakingWrongAnswerEvidence,
  createSpeakingWrongAnswerEvidence,
  resumeSpeakingWrongAnswerReview,
  speakingWrongAnswerOutcome,
  submitSpeakingWrongAnswerReview,
  type SpeakingWrongAnswerEvidenceSink,
  type SpeakingWrongAnswerIdentityResolver,
  type SpeakingWrongAnswerReviewStore,
  type SpeakingWrongAnswerReviewView,
} from './wrong-answer.ts'
