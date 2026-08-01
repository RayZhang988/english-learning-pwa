export {
  LearningAppPrototype,
  PracticeModuleGrid,
  TodayTaskList,
  type DailyPlanViewModel,
  type DailyTaskViewModel,
  type DailyTrainingTaskAccessViewModel,
  type AppSection,
  type LearningAppPrototypeProps,
  type PracticeModuleId,
  type PracticeModuleViewModel,
  type ProgressViewModel,
  type StartableTrainingTaskStatus,
  type TrainingPracticeModuleId,
  type TrainingTaskAccessViewModel,
  type TrainingTaskStatus,
  type TrainingTaskUnavailableReason,
} from './learning-app-prototype.tsx'
export {
  AiConversationPlaceholder,
  TrainingAreaHub,
  TravelSceneCategoryGrid,
  TravelSceneList,
  TravelScenePlaceholder,
  type TrainingAreaScreen,
} from './training-area-surfaces.tsx'
export {
  SceneVocabularyPracticeScreen,
  type SceneVocabularyPracticeScreenCallbacks,
  type SceneVocabularyPracticeScreenProps,
} from './scene-vocabulary-practice-screen.tsx'
export type {
  SceneVocabularyOptionState,
  SceneVocabularyPracticePresentation,
  SceneVocabularyPracticeView,
} from './scene-vocabulary-practice-types.ts'
export {
  getTravelScene,
  getTravelSceneCategory,
  trainingAreas,
  travelSceneCategories,
  travelScenes,
  type TrainingAreaDefinition,
  type TrainingAreaId,
  type TravelSceneCategoryDefinition,
  type TravelSceneDefinition,
} from './training-area-model.ts'
export { PlatformPrototype } from './platform-prototype.tsx'
export {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineNotice,
} from './feedback-states.tsx'
export {
  AssessmentChoiceScreen,
  AssessmentIntroScreen,
  AssessmentPausedScreen,
  AssessmentResultsScreen,
  AssessmentSpeechScreen,
  type AssessmentActionViewModel,
  type AssessmentChoiceScreenProps,
  type AssessmentChoiceSelectionIntent,
  type AssessmentChoiceViewModel,
  type AssessmentFallbackNoticeViewModel,
  type AssessmentIntroViewModel,
  type AssessmentLastSubmissionViewModel,
  type AssessmentPausedScreenProps,
  type AssessmentPausedViewModel,
  type AssessmentQuestionPrimaryActionViewModel,
  type AssessmentQuestionTarget,
  type AssessmentResultsViewModel,
  type AssessmentSecondaryActionViewModel,
  type AssessmentSpeechAudioViewModel,
  type AssessmentSpeechScreenProps,
  type AssessmentSpeechViewModel,
  type AssessmentSubmissionFailureReason,
} from './assessment-screens.tsx'
export {
  TravelVocabularyR1FinishConfirmationScreen,
  TravelVocabularyR1IntroScreen,
  TravelVocabularyR1MigrationScreen,
  TravelVocabularyR1QuestionScreen,
  TravelVocabularyR1ResultsScreen,
  TravelVocabularyR1ResumeScreen,
  TravelVocabularyR1StageResultScreen,
  TravelVocabularyR1StageReviewScreen,
  TravelVocabularyR1StatusScreen,
} from './travel-vocabulary-r1-screens.tsx'
export type {
  TravelVocabularyR1ActionViewModel,
  TravelVocabularyR1AdvanceIntent,
  TravelVocabularyR1ChoiceIntent,
  TravelVocabularyR1FinishConfirmationScreenProps,
  TravelVocabularyR1FinishConfirmationViewModel,
  TravelVocabularyR1HeaderProgressViewModel,
  TravelVocabularyR1IntroScreenProps,
  TravelVocabularyR1IntroViewModel,
  TravelVocabularyR1MigrationScreenProps,
  TravelVocabularyR1MigrationViewModel,
  TravelVocabularyR1NoticeViewModel,
  TravelVocabularyR1QuestionMapItemViewModel,
  TravelVocabularyR1QuestionOptionViewModel,
  TravelVocabularyR1QuestionScreenProps,
  TravelVocabularyR1QuestionTarget,
  TravelVocabularyR1QuestionViewModel,
  TravelVocabularyR1ResultsScreenProps,
  TravelVocabularyR1ResultsViewModel,
  TravelVocabularyR1ResumeScreenProps,
  TravelVocabularyR1ResumeViewModel,
  TravelVocabularyR1StageId,
  TravelVocabularyR1StageOrder,
  TravelVocabularyR1StageResultScreenProps,
  TravelVocabularyR1StageResultViewModel,
  TravelVocabularyR1StageReviewQuestionViewModel,
  TravelVocabularyR1StageReviewScreenProps,
  TravelVocabularyR1StageReviewViewModel,
  TravelVocabularyR1StageRouteItemViewModel,
  TravelVocabularyR1StageSummaryRowViewModel,
  TravelVocabularyR1StatusScreenProps,
  TravelVocabularyR1StatusViewModel,
} from './travel-vocabulary-r1-types.ts'
export {
  ListeningTrainingScreen,
  SpeakingTrainingScreen,
  VocabularyTrainingScreen,
  type ListeningScreenViewModel,
  type ListeningTrainingScreenCallbacks,
  type ListeningTrainingScreenProps,
  type SpeakingContentMatchViewModel,
  type SpeakingScreenViewModel,
  type SpeakingTrainingScreenCallbacks,
  type SpeakingTrainingScreenProps,
  type TrainingContentRetryCallbacks,
  type VocabularyTrainingScreenCallbacks,
  type VocabularyTrainingScreenProps,
  type VocabularyScreenViewModel,
} from './practice-screens.tsx'
export {
  ProgressOverviewScreen,
  type ProgressOverviewViewModel,
} from './progress-overview-screen.tsx'
export {
  MicrophonePermissionCard,
  SystemBanner,
  SystemStateCard,
  type MicrophonePermissionViewState,
  type SystemActionViewModel,
  type SystemStateViewModel,
} from './system-state-surfaces.tsx'
export {
  AudioPlayer,
  ChoiceList,
  FeedbackPanel,
  KeywordDictationField,
  ListeningPlaybackControls,
  Recorder,
  TrainingScreen,
  type TrainingContextNoticeViewModel,
} from './training-primitives.tsx'
export {
  ExtraListeningTrainingScreen,
  ExtraSpeakingTrainingScreen,
  ExtraTrainingCompletionScreen,
  ExtraTrainingPickerScreen,
  ExtraVocabularyTrainingScreen,
} from './extra-training-surfaces.tsx'
export type {
  ExtraListeningTrainingScreenProps,
  ExtraSpeakingTrainingScreenProps,
  ExtraTrainingCompletionScreenProps,
  ExtraTrainingPickerScreenProps,
  ExtraVocabularyTrainingScreenProps,
} from './extra-training-surfaces.tsx'
export type {
  CompletedDailyPlanExtraTrainingEntryViewModel,
  ExtraTrainingActionViewModel,
  ExtraTrainingActiveProgressViewModel,
  ExtraTrainingActiveSessionViewModel,
  ExtraTrainingCompletionViewModel,
  ExtraTrainingFailureReason,
  ExtraTrainingModuleId,
  ExtraTrainingModuleViewModel,
  ExtraTrainingPickerViewModel,
  ModuleCompletedExtraTrainingEntryViewModel,
} from './extra-training-view-models.ts'
export {
  TrainingBudgetProgress,
  TrainingBudgetTarget,
} from './training-budget-surfaces.tsx'
export {
  formatTrainingBudgetClock,
  formatTrainingBudgetTarget,
} from './training-budget-format.ts'
export type {
  TrainingBudgetProgressViewModel,
  TrainingBudgetRetryActionViewModel,
  TrainingBudgetStatus,
  TrainingBudgetTargetViewModel,
  TrainingContentExhaustedReason,
} from './training-budget-view-models.ts'
export {
  formatDurationEstimateBasis,
  formatEffectiveDuration,
  formatEstimatedDuration,
} from './duration-format.ts'
export {
  ActualEffectiveDuration,
  DailyEffectiveDurationSummary,
  TaskDurationEstimate,
  TrainingCompletionDurationScreen,
  TrainingUnitScore,
} from './duration-surfaces.tsx'
export type {
  ActualEffectiveDurationViewModel,
  DailyEffectiveDurationItemViewModel,
  DailyEffectiveDurationSummaryViewModel,
  DailyEffectiveDurationTotalViewModel,
  DurationTrainingModuleId,
  TaskDurationEstimateViewModel,
  TrainingCompletionDurationViewModel,
  TrainingUnitScoreViewModel,
} from './duration-view-models.ts'
export type {
  AbilityDomainId,
  AbilityResultViewModel,
  AudioPlayerViewModel,
  ChoiceViewModel,
  ChoiceVisualState,
  DomainProgressViewModel,
  FeedbackViewModel,
  ListeningKeywordDictationQuestionViewModel,
  ListeningPlaybackControlsViewModel,
  ListeningPlaybackRateOptionViewModel,
  ListeningQuestionInputIntent,
  ListeningQuestionViewModel,
  ListeningRepeatMode,
  ListeningRepeatOptionViewModel,
  ListeningSegmentViewModel,
  ListeningSingleChoiceQuestionViewModel,
  ListeningTextInputVisualState,
  RecorderViewModel,
  TrainingHeaderViewModel,
  TrainingProgressViewModel,
} from './view-models.ts'
export { Icon, type IconName } from './icons.tsx'
export { appTheme } from './theme.ts'
export { TrainingTestModeBanner } from './training-test-mode-banner.tsx'
