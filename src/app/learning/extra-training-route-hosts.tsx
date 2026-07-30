import {
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
import {
  ExtraListeningTrainingRuntime,
  resolveListeningSupplyQuestion,
  type ExtraListeningTrainingSnapshot,
  type ListeningSupplyItem,
} from '../../features/listening/index.ts'
import {
  ExtraSpeakingTrainingRuntime,
  resolveSpeakingSupplyPrompt,
  type ExtraSpeakingTrainingSnapshot,
  type SpeakingSupplyItem,
} from '../../features/speaking/index.ts'
import {
  buildVocabularySupplyQuestion,
  ExtraVocabularyTrainingRuntime,
  type ExtraVocabularyTrainingSnapshot,
  type VocabularySupplyItem,
} from '../../features/vocabulary/index.ts'
import {
  buildExtraTrainingSupplyRequest,
  type ExtraTrainingSession,
  type TrainingModuleId,
} from '../../learning-engine/index.ts'
import {
  browserMicrophonePermission,
} from '../../platform/index.ts'
import {
  EmptyState,
  ErrorState,
  ExtraListeningTrainingScreen,
  ExtraSpeakingTrainingScreen,
  ExtraTrainingCompletionScreen,
  ExtraTrainingPickerScreen,
  ExtraVocabularyTrainingScreen,
  LoadingState,
  type ListeningQuestionInputIntent,
  type ListeningRepeatMode,
} from '../../ui/index.ts'
import { useLearningApp } from './learning-app-context.ts'
import {
  isDailyPlanCompleted3Of3,
  toExtraListeningScreenViewModel,
  toExtraSpeakingScreenViewModel,
  toExtraTrainingActiveViewModel,
  toExtraTrainingCompletionViewModel,
  toExtraTrainingPickerViewModel,
  toExtraVocabularyScreenViewModel,
} from './extra-training-view-model.ts'
import {
  listeningContentSource,
  speakingContentSource,
  trainingSupplyProviders,
  vocabularyContentSource,
} from './training-production-resources.ts'

export const EXTRA_TRAINING_ROUTE = '/extra-training'

function useDurableRuntime<
  TSnapshot,
  TRuntime extends object,
>(
  runtime: TRuntime,
  initialize: () => Promise<TSnapshot>,
  dispose: () => Promise<void>,
) {
  const [snapshot, setSnapshot] = useState<TSnapshot | null>(null)
  const [error, setError] = useState<Error>()
  const [busy, setBusy] = useState(true)
  const busyRef = useRef(true)
  const generationRef = useRef(0)
  const initializeRef = useRef(initialize)
  const disposeRef = useRef(dispose)
  initializeRef.current = initialize
  disposeRef.current = dispose

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    let active = true
    const snapshotSource = runtime as {
      readonly subscribe?: (
        listener: (snapshot: TSnapshot) => void,
      ) => () => void
    }
    const unsubscribe = snapshotSource.subscribe?.((next) => {
      if (active) {
        setSnapshot(next)
      }
    })
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    void initializeRef.current().then(
      (next) => {
        if (active) {
          setSnapshot(next)
          busyRef.current = false
          setBusy(false)
        }
      },
      (reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason
              : new Error('额外训练恢复失败。'),
          )
          busyRef.current = false
          setBusy(false)
        }
      },
    )
    return () => {
      active = false
      unsubscribe?.()
      queueMicrotask(() => {
        if (generationRef.current === generation) {
          void disposeRef.current()
        }
      })
    }
  }, [runtime])

  const run = async (
    operation: () => Promise<TSnapshot>,
  ): Promise<TSnapshot | undefined> => {
    if (busyRef.current) {
      return undefined
    }
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      const next = await operation()
      setSnapshot(next)
      return next
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : new Error('额外训练操作失败。'),
      )
      return undefined
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return {
    snapshot,
    error,
    busy,
    run,
  }
}

function sessionFailure(
  title: string,
  error: Error,
  retry: () => void,
) {
  return (
    <main className="full-page-feedback">
      <ErrorState
        title={title}
        description={error.message}
        onRetry={retry}
      />
    </main>
  )
}

function loading(label: string) {
  return (
    <main className="full-page-feedback">
      <LoadingState label={label} />
    </main>
  )
}

export function ExtraTrainingPickerRouteHost() {
  const navigate = useNavigate()
  const { coordinator, state } = useLearningApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const busyRef = useRef(false)

  if (state.status === 'loading') {
    return loading('正在恢复额外训练记录')
  }
  if (state.status !== 'ready') {
    return (
      <main className="full-page-feedback">
        <EmptyState
          title="暂时不能继续训练"
          description="请先恢复并完成今天的三个必做训练任务。"
        />
      </main>
    )
  }
  if (
    !isDailyPlanCompleted3Of3(
      state.runtime.activePlan,
      state.localDate,
    )
  ) {
    return (
      <main className="full-page-feedback">
        <EmptyState
          title="完成今日 3/3 后再继续训练"
          description="额外训练不会替代今天尚未完成的必做任务。"
        />
      </main>
    )
  }
  if (error) {
    return sessionFailure(
      '无法打开额外训练',
      error,
      () => setError(undefined),
    )
  }

  const run = async (
    operation: () => Promise<void>,
  ) => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      await operation()
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : new Error('额外训练请求失败。'),
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const openSession = (sessionId: string, retry = false) => {
    const route = coordinator.routeForExtraTrainingSession(sessionId)
    navigate(retry ? `${route}&retry=1` : route)
  }

  return (
    <ExtraTrainingPickerScreen
      viewModel={toExtraTrainingPickerViewModel(
        state.engineState,
        state.localDate,
        busy,
      )}
      onStartRequested={(moduleId) =>
        run(async () => {
          const session =
            await coordinator.startExtraTraining(moduleId)
          openSession(session.sessionId)
        })
      }
      onStartFreshRequested={(moduleId) =>
        run(async () => {
          const session =
            await coordinator.startFreshExtraTraining(moduleId)
          openSession(session.sessionId)
        })
      }
      onResumeRequested={(sessionId) =>
        run(async () => {
          coordinator.resolveExtraTrainingSession(sessionId)
          openSession(sessionId)
        })
      }
      onRetryRequested={(sessionId) =>
        run(async () => {
          coordinator.resolveExtraTrainingSession(sessionId)
          openSession(sessionId, true)
        })
      }
      onReturnToCompletedPlan={() => navigate('/')}
    />
  )
}

async function initializeVocabulary(
  runtime: ExtraVocabularyTrainingRuntime,
  retryRequested: boolean,
): Promise<ExtraVocabularyTrainingSnapshot> {
  let snapshot = await runtime.initialize()
  snapshot = await runtime.flush()
  if (
    retryRequested &&
    snapshot.session.status === 'failed'
  ) {
    snapshot = await runtime.retry()
    snapshot = await runtime.flush()
  } else if (snapshot.session.status === 'paused') {
    snapshot = await runtime.resume()
    snapshot = await runtime.flush()
  }
  if (
    !snapshot.activeItem &&
    snapshot.session.status !== 'completed' &&
    snapshot.session.status !== 'failed'
  ) {
    snapshot = await runtime.next()
    snapshot = await runtime.flush()
  }
  if (
    snapshot.question &&
    snapshot.phase === 'answering'
  ) {
    snapshot = await runtime.startTiming()
  }
  return snapshot
}

function ExtraVocabularyRoute({
  session,
  retryRequested,
}: {
  readonly session: ExtraTrainingSession
  readonly retryRequested: boolean
}) {
  const navigate = useNavigate()
  const { coordinator } = useLearningApp()
  const [runtime] = useState(
    () =>
      new ExtraVocabularyTrainingRuntime({
        session,
        supplyRequest: buildExtraTrainingSupplyRequest,
        supplyProvider: trainingSupplyProviders.vocabulary,
        timingSessionFactory:
          coordinator.extraTrainingTimingSessions,
        eventSink: coordinator.extraTraining.eventSink,
        questionForItem: async (item: VocabularySupplyItem) => {
          const catalog = await vocabularyContentSource.load()
          const source = catalog.getItem(item.source.sourceId)
          const distractors = item.source.distractorItemIds.map(
            (itemId) => catalog.getItem(itemId),
          )
          if (!source || distractors.some((entry) => !entry)) {
            throw new TypeError(
              'Vocabulary supply item references unavailable released content.',
            )
          }
          return buildVocabularySupplyQuestion(
            item.itemId,
            source,
            distractors.filter(
              (entry): entry is NonNullable<typeof entry> =>
                entry !== undefined,
            ),
            item.source.variantId,
          )
        },
      }),
  )
  const controller = useDurableRuntime(
    runtime,
    () =>
      initializeVocabulary(runtime, retryRequested),
    async () => {
      if (
        runtime.currentSnapshot &&
        runtime.currentSnapshot.session.status !== 'completed'
      ) {
        await runtime.pauseTiming()
      }
    },
  )

  if (controller.error) {
    return sessionFailure(
      '额外词汇训练暂时无法继续',
      controller.error,
      () => {
        void controller.run(() =>
          initializeVocabulary(runtime, true),
        )
      },
    )
  }
  if (!controller.snapshot) {
    return loading('正在恢复额外词汇训练')
  }
  const snapshot = controller.snapshot
  if (snapshot.session.status === 'failed') {
    return sessionFailure(
      '额外词汇训练内容暂时不可用',
      new Error('会话进度已保存，可以重试当前会话。'),
      () => {
        void controller.run(async () => {
          await runtime.retry()
          await runtime.flush()
          return runtime.startTiming()
        })
      },
    )
  }
  if (!snapshot.question) {
    return loading('正在获取额外词汇题目')
  }

  return (
    <ExtraVocabularyTrainingScreen
      viewModel={toExtraVocabularyScreenViewModel(
        snapshot,
        controller.busy,
      )}
      extraTraining={toExtraTrainingActiveViewModel(
        session,
        'vocabulary',
        controller.busy,
      )}
      onSelect={(optionId) => {
        void controller.run(async () => {
          return runtime.select(optionId)
        })
      }}
      onAction={() => {
        void controller.run(async () => {
          const current = runtime.currentSnapshot
          if (current?.phase === 'feedback') {
            let next = await runtime.advanceAfterFeedback()
            next = await runtime.flush()
            if (
              next.phase === 'answering' &&
              next.question
            ) {
              next = await runtime.startTiming()
            }
            return next
          }
          return runtime.submit()
        })
      }}
      onExitRequested={async () => {
        await controller.run(async () => {
          let next = await runtime.exit()
          next = await runtime.flush()
          navigate(EXTRA_TRAINING_ROUTE, { replace: true })
          return next
        })
      }}
      onRetryRequested={async () => {
        await controller.run(async () => {
          let next = await runtime.retry()
          next = await runtime.flush()
          next = await runtime.startTiming()
          return next
        })
      }}
    />
  )
}

async function initializeListening(
  runtime: ExtraListeningTrainingRuntime,
  retryRequested: boolean,
): Promise<ExtraListeningTrainingSnapshot> {
  let snapshot = await runtime.initialize()
  snapshot = await runtime.flush()
  if (
    retryRequested &&
    snapshot.session.status === 'failed'
  ) {
    snapshot = await runtime.retryFailure()
    snapshot = await runtime.flush()
  } else if (snapshot.session.status === 'paused') {
    snapshot = await runtime.resume()
    snapshot = await runtime.flush()
  }
  if (
    !snapshot.activeItem &&
    snapshot.session.status !== 'completed' &&
    snapshot.session.status !== 'failed'
  ) {
    snapshot = await runtime.next()
    snapshot = await runtime.flush()
  }
  return snapshot
}

function ExtraListeningRoute({
  session,
  retryRequested,
}: {
  readonly session: ExtraTrainingSession
  readonly retryRequested: boolean
}) {
  const navigate = useNavigate()
  const { coordinator } = useLearningApp()
  const [runtime] = useState(
    () =>
      new ExtraListeningTrainingRuntime({
        session,
        supplyRequest: buildExtraTrainingSupplyRequest,
        supplyProvider: trainingSupplyProviders.listening,
        timingSessionFactory:
          coordinator.extraTrainingTimingSessions,
        eventSink: coordinator.extraTraining.eventSink,
        questionForItem: async (item: ListeningSupplyItem) =>
          resolveListeningSupplyQuestion(
            await listeningContentSource.load(),
            item,
          ),
      }),
  )
  const controller = useDurableRuntime(
    runtime,
    () =>
      initializeListening(runtime, retryRequested),
    () => runtime.dispose(),
  )

  if (controller.error) {
    return sessionFailure(
      '额外听力训练暂时无法继续',
      controller.error,
      () => {
        void controller.run(() =>
          initializeListening(runtime, true),
        )
      },
    )
  }
  if (!controller.snapshot) {
    return loading('正在恢复额外听力训练')
  }
  const snapshot = controller.snapshot
  if (snapshot.session.status === 'failed') {
    return sessionFailure(
      '额外听力训练暂时不可用',
      new Error('会话进度已保存，可以重试内容或设备能力。'),
      () => {
        void controller.run(async () => {
          let next = await runtime.retryFailure()
          next = await runtime.flush()
          return next
        })
      },
    )
  }
  if (!snapshot.question || !snapshot.playback) {
    return loading('正在获取额外听力题目')
  }
  const updateQuestion = (
    intent: ListeningQuestionInputIntent,
  ) =>
    intent.type === 'select-choice'
      ? runtime.select(intent.choiceId)
      : runtime.changeDictation(intent.value)

  return (
    <ExtraListeningTrainingScreen
      viewModel={toExtraListeningScreenViewModel(
        snapshot,
        controller.busy,
      )}
      extraTraining={toExtraTrainingActiveViewModel(
        session,
        'listening',
        controller.busy,
      )}
      onToggleAudio={() => {
        void controller.run(() => runtime.toggleAudio())
      }}
      onPlaybackRateChange={(rate) => {
        void controller.run(() => runtime.setPlaybackRate(rate))
      }}
      onSegmentChange={(segmentId) => {
        void controller.run(() => runtime.selectSegment(segmentId))
      }}
      onRepeatModeChange={(mode: ListeningRepeatMode) => {
        void controller.run(() => runtime.setRepeatMode(mode))
      }}
      onQuestionInput={(intent) => {
        void controller.run(() => updateQuestion(intent))
      }}
      onAction={() => {
        void controller.run(async () => {
          const current = runtime.currentSnapshot
          if (current?.phase === 'feedback') {
            let next = await runtime.completeCurrentItem()
            if (next.session.status !== 'completed') {
              next = await runtime.next()
              next = await runtime.flush()
            }
            return next
          }
          return runtime.submit()
        })
      }}
      onExitRequested={async () => {
        await controller.run(async () => {
          let next = await runtime.exit()
          next = await runtime.flush()
          navigate(EXTRA_TRAINING_ROUTE, { replace: true })
          return next
        })
      }}
      onRetryRequested={async () => {
        await controller.run(async () => {
          let next = await runtime.retryFailure()
          next = await runtime.flush()
          return next
        })
      }}
    />
  )
}

async function initializeSpeaking(
  runtime: ExtraSpeakingTrainingRuntime,
  retryRequested: boolean,
): Promise<ExtraSpeakingTrainingSnapshot> {
  let snapshot = await runtime.initialize()
  snapshot = await runtime.flush()
  if (
    retryRequested &&
    snapshot.session.status === 'failed'
  ) {
    snapshot = await runtime.retryFailure()
    snapshot = await runtime.flush()
  } else if (snapshot.session.status === 'paused') {
    snapshot = await runtime.resume()
    snapshot = await runtime.flush()
  }
  if (
    !snapshot.activeItem &&
    snapshot.session.status !== 'completed' &&
    snapshot.session.status !== 'failed'
  ) {
    snapshot = await runtime.next()
    snapshot = await runtime.flush()
  }
  return snapshot
}

function ExtraSpeakingRoute({
  session,
  retryRequested,
}: {
  readonly session: ExtraTrainingSession
  readonly retryRequested: boolean
}) {
  const navigate = useNavigate()
  const { coordinator } = useLearningApp()
  const [runtime] = useState(
    () =>
      new ExtraSpeakingTrainingRuntime({
        session,
        supplyRequest: buildExtraTrainingSupplyRequest,
        supplyProvider: trainingSupplyProviders.speaking,
        timingSessionFactory:
          coordinator.extraTrainingTimingSessions,
        eventSink: coordinator.extraTraining.eventSink,
        promptForItem: async (item: SpeakingSupplyItem) =>
          resolveSpeakingSupplyPrompt(
            await speakingContentSource.load(),
            item,
          ),
        requestMicrophone: () =>
          browserMicrophonePermission.request(),
      }),
  )
  const controller = useDurableRuntime(
    runtime,
    () =>
      initializeSpeaking(runtime, retryRequested),
    () => runtime.dispose(),
  )

  if (controller.error) {
    return sessionFailure(
      '额外口语训练暂时无法继续',
      controller.error,
      () => {
        void controller.run(() =>
          initializeSpeaking(runtime, true),
        )
      },
    )
  }
  if (!controller.snapshot) {
    return loading('正在恢复额外口语训练')
  }
  const snapshot = controller.snapshot
  if (snapshot.session.status === 'failed') {
    return sessionFailure(
      '额外口语训练内容暂时不可用',
      new Error('会话进度已保存，可以重试当前内容。'),
      () => {
        void controller.run(async () => {
          let next = await runtime.retryFailure()
          next = await runtime.flush()
          return next
        })
      },
    )
  }
  if (!snapshot.prompt) {
    return loading('正在获取额外口语题目')
  }
  return (
    <ExtraSpeakingTrainingScreen
      viewModel={toExtraSpeakingScreenViewModel(
        snapshot,
        controller.busy,
      )}
      extraTraining={toExtraTrainingActiveViewModel(
        session,
        'speaking',
        controller.busy,
      )}
      onRecorderAction={() => {
        void controller.run(async () => {
          return runtime.currentSnapshot?.recordingAvailable
            ? runtime.stopRecording()
            : runtime.startRecording()
        })
      }}
      onPlayback={() => {
        void controller.run(() => runtime.playRecording())
      }}
      onAction={() => {
        void controller.run(async () => {
          const current = runtime.currentSnapshot
          if (current?.phase !== 'feedback') {
            return current ?? runtime.initialize()
          }
          let next = await runtime.completeCurrentItem()
          if (next.session.status !== 'completed') {
            next = await runtime.next()
            next = await runtime.flush()
          }
          return next
        })
      }}
      onSecondaryAction={() => {
        void controller.run(async () => {
          return runtime.continueWithoutRecording()
        })
      }}
      onExitRequested={async () => {
        await controller.run(async () => {
          let next = await runtime.exit()
          next = await runtime.flush()
          navigate(EXTRA_TRAINING_ROUTE, { replace: true })
          return next
        })
      }}
      onRetryRequested={async () => {
        await controller.run(async () => {
          let next = await runtime.retryFailure()
          next = await runtime.flush()
          return next
        })
      }}
    />
  )
}

export function ExtraTrainingRouteHost() {
  const navigate = useNavigate()
  const { moduleId } = useParams<{ readonly moduleId: string }>()
  const [searchParams] = useSearchParams()
  const { coordinator, state } = useLearningApp()
  const sessionId = searchParams.get('sessionId')

  if (state.status === 'loading') {
    return loading('正在恢复额外训练会话')
  }
  if (state.status !== 'ready') {
    return (
      <main className="full-page-feedback">
        <EmptyState
          title="额外训练暂时不可用"
          description="请先恢复今天的学习计划。"
        />
      </main>
    )
  }
  if (
    !sessionId ||
    (moduleId !== 'vocabulary' &&
      moduleId !== 'listening' &&
      moduleId !== 'speaking')
  ) {
    return (
      <main className="full-page-feedback">
        <ErrorState
          title="额外训练地址无效"
          description="请从继续训练页面重新选择模块。"
          onRetry={() => navigate(EXTRA_TRAINING_ROUTE)}
        />
      </main>
    )
  }

  let session: ExtraTrainingSession
  try {
    session = coordinator.resolveExtraTrainingSession(
      sessionId,
      moduleId as TrainingModuleId,
    )
  } catch (reason) {
    return sessionFailure(
      '无法恢复额外训练会话',
      reason instanceof Error
        ? reason
        : new Error('额外训练会话与当前日期不匹配。'),
      () => navigate(EXTRA_TRAINING_ROUTE),
    )
  }

  if (session.status === 'completed') {
    return (
      <ExtraTrainingCompletionScreen
        viewModel={toExtraTrainingCompletionViewModel(session)}
        onChooseAnotherRequested={() =>
          navigate(EXTRA_TRAINING_ROUTE, { replace: true })
        }
        onReturnToCompletedPlan={() =>
          navigate('/', { replace: true })
        }
      />
    )
  }
  if (
    session.status === 'failed' &&
    searchParams.get('retry') !== '1'
  ) {
    return (
      <ExtraTrainingPickerScreen
        viewModel={toExtraTrainingPickerViewModel(
          state.engineState,
          state.localDate,
        )}
        onStartRequested={async (targetModuleId) => {
          const next =
            await coordinator.startExtraTraining(targetModuleId)
          navigate(
            coordinator.routeForExtraTrainingSession(
              next.sessionId,
            ),
          )
        }}
        onStartFreshRequested={async (targetModuleId) => {
          const next =
            await coordinator.startFreshExtraTraining(targetModuleId)
          navigate(
            coordinator.routeForExtraTrainingSession(
              next.sessionId,
            ),
          )
        }}
        onResumeRequested={(targetSessionId) =>
          navigate(
            coordinator.routeForExtraTrainingSession(
              targetSessionId,
            ),
          )
        }
        onRetryRequested={(targetSessionId) =>
          navigate(
            `${coordinator.routeForExtraTrainingSession(targetSessionId)}&retry=1`,
          )
        }
        onReturnToCompletedPlan={() => navigate('/')}
      />
    )
  }

  const retryRequested = searchParams.get('retry') === '1'
  if (moduleId === 'vocabulary') {
    return (
      <ExtraVocabularyRoute
        key={session.sessionId}
        session={session}
        retryRequested={retryRequested}
      />
    )
  }
  if (moduleId === 'listening') {
    return (
      <ExtraListeningRoute
        key={session.sessionId}
        session={session}
        retryRequested={retryRequested}
      />
    )
  }
  return (
    <ExtraSpeakingRoute
      key={session.sessionId}
      session={session}
      retryRequested={retryRequested}
    />
  )
}
