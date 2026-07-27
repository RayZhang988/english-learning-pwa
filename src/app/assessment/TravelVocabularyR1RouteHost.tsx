import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  browserNetworkStatus,
  type NetworkStatus,
} from '../../platform/index.ts'
import {
  TravelVocabularyR1IntroScreen,
  TravelVocabularyR1MigrationScreen,
  TravelVocabularyR1QuestionScreen,
  TravelVocabularyR1ResultsScreen,
  TravelVocabularyR1ResumeScreen,
  TravelVocabularyR1StageResultScreen,
  TravelVocabularyR1StageReviewScreen,
  TravelVocabularyR1StatusScreen,
} from '../../ui/index.ts'
import {
  travelVocabularyR1AppCoordinator,
  type TravelVocabularyR1AppCoordinator,
  type TravelVocabularyR1AppState,
} from './travel-vocabulary-r1-app-coordinator.ts'
import {
  toTravelVocabularyR1IntroViewModel,
  toTravelVocabularyR1MigrationViewModel,
  toTravelVocabularyR1QuestionViewModel,
  toTravelVocabularyR1ResultsViewModel,
  toTravelVocabularyR1ResumeViewModel,
  toTravelVocabularyR1StageResultViewModel,
  toTravelVocabularyR1StageReviewViewModel,
} from './travel-vocabulary-r1-view-model.ts'

export const ASSESSMENT_ROUTE = '/assessment'
export const ASSESSMENT_RESULTS_ROUTE = '/assessment?mode=results'

export interface TravelVocabularyR1RouteHostProps {
  readonly coordinator?: TravelVocabularyR1AppCoordinator
}

export function TravelVocabularyR1RouteHost({
  coordinator = travelVocabularyR1AppCoordinator,
}: TravelVocabularyR1RouteHostProps) {
  const navigate = useNavigate()
  const [state, setState] = useState<TravelVocabularyR1AppState>(
    coordinator.state,
  )
  const [network, setNetwork] = useState<NetworkStatus>(() =>
    browserNetworkStatus.current(),
  )
  const [reviewingStage, setReviewingStage] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState)
    void coordinator.initialize()
    return unsubscribe
  }, [coordinator])

  useEffect(
    () => browserNetworkStatus.subscribe(setNetwork),
    [],
  )

  useEffect(() => {
    if (
      state.status !== 'ready' ||
      state.runtime.lifecycle !== 'active'
    ) {
      setReviewingStage(false)
    }
  }, [state])

  const run = async (
    operation: () => Promise<unknown>,
    after?: () => void,
  ) => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
      after?.()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (state.status === 'loading') {
    return (
      <TravelVocabularyR1StatusScreen
        viewModel={{
          kind: 'loading',
          label: '正在读取本机 R1 旅游英语词汇测试',
        }}
        onExit={() => navigate('/')}
      />
    )
  }

  if (state.status === 'error') {
    const preserving =
      state.recovery === 'preserve-and-start-fresh'
    const retryingCompletion =
      state.recovery === 'retry-completion'
    return (
      <TravelVocabularyR1StatusScreen
        viewModel={{
          kind: 'error',
          title: 'R1 水平测试暂时无法继续',
          description: state.error.message,
          retryAction: {
            label: preserving
              ? '保留原记录并重新抽题'
              : retryingCompletion
                ? '重新保存结果和首日计划'
                : '重新读取本机记录',
            disabled: busy,
            busy,
            busyLabel: '正在处理',
            disabledReason: busy ? '正在处理本机记录。' : undefined,
          },
        }}
        onExit={() => navigate('/')}
        onRetry={() => {
          void run(() =>
            preserving
              ? coordinator.recoverWithFreshSample()
              : retryingCompletion
                ? coordinator.retryCompletion()
                : coordinator.initialize(),
          )
        }}
      />
    )
  }

  if (state.status === 'profile-ready') {
    return (
      <TravelVocabularyR1ResultsScreen
        viewModel={toTravelVocabularyR1ResultsViewModel(
          state.profile,
          busy,
        )}
        onExit={() => navigate('/')}
        onContinue={() => navigate('/')}
      />
    )
  }

  const runtime = state.runtime
  const offline = network === 'offline'
  const sessionMatches = (sessionId: string) =>
    sessionId === runtime.sessionId
  const targetMatches = (
    questionId: string,
    questionIndex: number,
  ) =>
    runtime.questions[questionIndex]?.id === questionId

  const pauseAndExit = async (sessionId: string) => {
    if (!sessionMatches(sessionId)) {
      return
    }
    if (runtime.actions.canPause) {
      await coordinator.pause()
    }
    navigate('/')
  }

  if (
    runtime.lifecycle === 'intro' &&
    state.migrationSource !== null
  ) {
    return (
      <TravelVocabularyR1MigrationScreen
        viewModel={toTravelVocabularyR1MigrationViewModel(
          runtime,
          state.migrationSource,
          busy,
        )}
        onExit={() => navigate('/')}
        onStartNewAssessment={(sessionId) => {
          if (sessionMatches(sessionId)) {
            void run(() => coordinator.start())
          }
        }}
      />
    )
  }

  if (runtime.lifecycle === 'intro') {
    return (
      <TravelVocabularyR1IntroScreen
        viewModel={toTravelVocabularyR1IntroViewModel(runtime, {
          busy,
          offline,
        })}
        onExit={() => navigate('/')}
        onStart={(sessionId) => {
          if (sessionMatches(sessionId)) {
            void run(() => coordinator.start())
          }
        }}
      />
    )
  }

  if (runtime.lifecycle === 'paused') {
    return (
      <TravelVocabularyR1ResumeScreen
        viewModel={toTravelVocabularyR1ResumeViewModel(runtime, {
          busy,
          offline,
        })}
        onExit={() => navigate('/')}
        onResume={(sessionId) => {
          if (sessionMatches(sessionId)) {
            void run(() => coordinator.resume())
          }
        }}
      />
    )
  }

  if (runtime.lifecycle === 'completed' && runtime.profile) {
    return (
      <TravelVocabularyR1ResultsScreen
        viewModel={toTravelVocabularyR1ResultsViewModel(
          runtime.profile,
          busy,
        )}
        onExit={() => navigate('/')}
        onContinue={() => navigate('/')}
      />
    )
  }

  if (runtime.lifecycle === 'stage-summary') {
    return (
      <TravelVocabularyR1StageResultScreen
        viewModel={toTravelVocabularyR1StageResultViewModel(runtime, {
          busy,
          offline,
        })}
        onExit={(sessionId) => {
          void run(() => pauseAndExit(sessionId))
        }}
        onPause={(sessionId) => {
          void run(() => pauseAndExit(sessionId))
        }}
        onContinueToNextStage={(sessionId) => {
          if (sessionMatches(sessionId)) {
            void run(() => coordinator.continueToNextStage())
          }
        }}
      />
    )
  }

  if (reviewingStage) {
    return (
      <TravelVocabularyR1StageReviewScreen
        viewModel={toTravelVocabularyR1StageReviewViewModel(runtime, {
          busy,
          offline,
        })}
        onExit={(sessionId) => {
          void run(() => pauseAndExit(sessionId))
        }}
        onBack={(sessionId) => {
          if (sessionMatches(sessionId)) {
            setReviewingStage(false)
          }
        }}
        onNavigate={(target) => {
          if (
            sessionMatches(target.sessionId) &&
            targetMatches(target.questionId, target.questionIndex)
          ) {
            void run(
              () => coordinator.navigate(target.questionIndex),
              () => setReviewingStage(false),
            )
          }
        }}
        onSubmitStage={(sessionId) => {
          if (sessionMatches(sessionId)) {
            void run(
              () => coordinator.submitStage(),
              () => setReviewingStage(false),
            )
          }
        }}
      />
    )
  }

  return (
    <TravelVocabularyR1QuestionScreen
      viewModel={toTravelVocabularyR1QuestionViewModel(runtime, {
        busy,
        offline,
      })}
      onExit={(sessionId) => {
        void run(() => pauseAndExit(sessionId))
      }}
      onSelectChoice={(intent) => {
        if (
          sessionMatches(intent.sessionId) &&
          targetMatches(intent.questionId, intent.questionIndex)
        ) {
          void run(() =>
            coordinator.selectChoice(
              intent.questionId,
              intent.optionId,
            ),
          )
        }
      }}
      onMarkUncertain={(target) => {
        if (
          sessionMatches(target.sessionId) &&
          targetMatches(target.questionId, target.questionIndex)
        ) {
          void run(() => coordinator.markUncertain(target.questionId))
        }
      }}
      onClearAnswer={(target) => {
        if (
          sessionMatches(target.sessionId) &&
          targetMatches(target.questionId, target.questionIndex)
        ) {
          void run(() => coordinator.clearAnswer(target.questionId))
        }
      }}
      onNavigate={(target) => {
        if (
          sessionMatches(target.sessionId) &&
          targetMatches(target.questionId, target.questionIndex)
        ) {
          void run(() => coordinator.navigate(target.questionIndex))
        }
      }}
      onReviewStage={(sessionId) => {
        if (sessionMatches(sessionId) && !busyRef.current) {
          setReviewingStage(true)
        }
      }}
      onPause={(sessionId) => {
        void run(() => pauseAndExit(sessionId))
      }}
    />
  )
}
