import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  AsyncDataState,
  PlatformEventSink,
  ReadonlyDataSource,
} from '../../core/index.ts'
import type { LearningTask } from '../../learning-engine/index.ts'
import {
  browserNetworkStatus,
  type NetworkStatus,
  type NetworkStatusService,
} from '../../platform/index.ts'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineNotice,
  TrainingUnitScore,
} from '../../ui/index.ts'
import {
  currentListeningContentSource,
} from './content-source.ts'
import { ListeningSessionScreen } from './ListeningSessionScreen.tsx'
import { ListeningSessionRepository } from './repository.ts'
import { ListeningRuntimeMountLifecycle } from './route-lifecycle.ts'
import { ListeningTrainingRuntime } from './runtime.ts'
import { getListeningSessionResult } from './session.ts'
import type { ListeningSupplyProvider } from './supply.ts'
import type { ListeningSpeechPort } from './speech-synthesis.ts'
import type {
  ListeningEffectiveTimingSessionFactoryPort,
} from './timing.ts'
import type {
  ListeningCatalog,
  ListeningRepeatMode,
  ListeningSession,
} from './types.ts'

export interface ListeningTrainingRouteProps {
  readonly task: LearningTask
  readonly localDate: string
  readonly eventSink: PlatformEventSink
  readonly onExit: () => void
  readonly onCompleted?: (session: ListeningSession) => void
  readonly contentSource?: ReadonlyDataSource<ListeningCatalog>
  readonly repository?: ListeningSessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly speech?: ListeningSpeechPort
  readonly now?: () => string
  readonly createId?: () => string
  readonly timingSessionFactory?: ListeningEffectiveTimingSessionFactoryPort
  /** 01 supplies both ports for QA-011 budget tasks. */
  readonly supplyProvider?: ListeningSupplyProvider
  readonly trainingBudgetStatus?: () => 'running' | 'finish-current-item'
}

export function ListeningTrainingRoute(
  props: ListeningTrainingRouteProps,
) {
  const networkStatus = props.networkStatus ?? browserNetworkStatus
  const [network, setNetwork] = useState<NetworkStatus>(() =>
    networkStatus.current(),
  )
  const [state, setState] = useState<AsyncDataState<ListeningSession>>({
    status: 'loading',
  })
  const exitPendingRef = useRef(false)
  const runtimeKey = `${props.task.planId}:${props.task.taskId}`
  const runtimeRef = useRef<{
    readonly key: string
    readonly runtime: ListeningTrainingRuntime
    readonly timingSessionFactory:
      | ListeningEffectiveTimingSessionFactoryPort
      | undefined
    readonly supplyProvider: ListeningSupplyProvider | undefined
    readonly trainingBudgetStatus: (() => 'running' | 'finish-current-item') | undefined
  } | null>(null)
  const runtimeMountLifecycleRef =
    useRef<ListeningRuntimeMountLifecycle | null>(null)
  const completedTaskRef = useRef<string | null>(null)
  if (!runtimeMountLifecycleRef.current) {
    runtimeMountLifecycleRef.current =
      new ListeningRuntimeMountLifecycle()
  }

  if (
    runtimeRef.current?.key !== runtimeKey ||
    runtimeRef.current.timingSessionFactory !==
      props.timingSessionFactory ||
    runtimeRef.current.supplyProvider !== props.supplyProvider ||
    runtimeRef.current.trainingBudgetStatus !== props.trainingBudgetStatus
  ) {
    runtimeRef.current = {
      key: runtimeKey,
      timingSessionFactory: props.timingSessionFactory,
      supplyProvider: props.supplyProvider,
      trainingBudgetStatus: props.trainingBudgetStatus,
      runtime: new ListeningTrainingRuntime({
        task: props.task,
        localDate: props.localDate,
        contentSource:
          props.contentSource ?? currentListeningContentSource,
        eventSink: props.eventSink,
        repository: props.repository,
        networkStatus,
        speech: props.speech,
        now: props.now,
        createId: props.createId,
        timingSessionFactory: props.timingSessionFactory,
        supplyProvider: props.supplyProvider,
        trainingBudgetStatus: props.trainingBudgetStatus,
      }),
    }
  }
  const runtime = runtimeRef.current.runtime

  const showSession = useCallback((session: ListeningSession) => {
    setState({ status: 'ready', value: session })
  }, [])
  const showError = useCallback((error: unknown) => {
    setState({
      status: 'error',
      error:
        error instanceof Error
          ? error
          : new Error('听力训练发生未知错误。'),
    })
  }, [])
  const perform = useCallback(
    async (operation: () => Promise<ListeningSession>) => {
      try {
        await operation()
      } catch (error) {
        showError(error)
      }
    },
    [showError],
  )

  useEffect(() => runtime.subscribe(showSession), [runtime, showSession])

  useEffect(() => {
    let active = true
    const releaseRuntime =
      runtimeMountLifecycleRef.current!.retain(runtime)
    setState({ status: 'loading' })
    void runtime.initialize().then(
      (session) => {
        if (active) {
          showSession(session)
        }
      },
      (error: unknown) => {
        if (active) {
          showError(error)
        }
      },
    )
    return () => {
      active = false
      releaseRuntime()
    }
  }, [runtime, showError, showSession])

  useEffect(
    () => networkStatus.subscribe(setNetwork),
    [networkStatus],
  )

  useEffect(() => {
    const onVisibilityChange = () => {
      const session = runtime.currentSession
      if (
        document.visibilityState === 'hidden' &&
        session &&
        (session.phase === 'answering' ||
          session.phase === 'feedback')
      ) {
        void perform(() => runtime.pause('app-backgrounded'))
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange,
      )
    }
  }, [perform, runtime])

  useEffect(() => {
    if (
      state.status === 'ready' &&
      state.value.phase === 'completed' &&
      completedTaskRef.current !== state.value.task.taskId
    ) {
      completedTaskRef.current = state.value.task.taskId
      props.onCompleted?.(state.value)
    }
  }, [props, state])

  const retry = useCallback(() => {
    const session = runtime.currentSession
    if (session?.phase === 'error') {
      void perform(() => session.stream ? runtime.retrySupply() : runtime.restart())
    } else if (session) {
      void perform(() => runtime.retryPendingEvents())
    } else {
      void perform(() => runtime.initialize())
    }
  }, [perform, runtime])

  const exit = useCallback(() => {
    if (exitPendingRef.current) {
      return
    }
    exitPendingRef.current = true
    const session = runtime.currentSession
    void (async () => {
      try {
        if (
          session &&
          (session.phase === 'answering' ||
            session.phase === 'feedback')
        ) {
          await runtime.pause('user-paused')
        }
        await runtime.dispose()
        props.onExit()
      } catch (error) {
        exitPendingRef.current = false
        showError(error)
      }
    })()
  }, [props, runtime, showError])

  if (state.status === 'loading' || state.status === 'idle') {
    return <LoadingState label="正在加载听力训练" />
  }
  if (state.status === 'empty') {
    return (
      <EmptyState
        title="没有可用的听力任务"
        description="学习计划暂未下发听力任务。"
      />
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="听力训练暂时无法继续"
        description={state.error.message}
        onRetry={retry}
      />
    )
  }

  const session = state.value
  if (session.phase === 'error') {
    return (
      <>
        {network === 'offline' ? <OfflineNotice /> : null}
        <ErrorState
          title="本次听力任务无法评分"
          description={
            session.failure?.message ?? '听力任务遇到不可恢复的错误。'
          }
          onRetry={retry}
        />
      </>
    )
  }
  if (session.phase === 'completed') {
    const result = getListeningSessionResult(session)
    const totalCount = result.questionCount
    return (
      <EmptyState
        title="听力任务已完成"
        description={`已完成 ${totalCount} 道题，学习结果已上报。`}
        details={(
          <TrainingUnitScore
            score={{
              state: 'available',
              correctCount: result.correctCount,
              totalCount,
              percentage:
                totalCount === 0
                  ? null
                  : Math.round(
                      result.correctCount / totalCount * 100,
                    ),
              unscorableCount: 0,
            }}
          />
        )}
        action={(
          <button
            className="primary-button"
            type="button"
            onClick={props.onExit}
          >
            返回今日计划
          </button>
        )}
      />
    )
  }

  return (
    <>
      {network === 'offline' ? <OfflineNotice /> : null}
      <ListeningSessionScreen
        session={session}
        onExit={exit}
        onToggleAudio={() => {
          void perform(() => runtime.togglePlayback())
        }}
        onRateChange={(rate) => {
          void perform(() => runtime.setRate(rate))
        }}
        onSegmentChange={(segmentId) => {
          void perform(() => runtime.selectSegment(segmentId))
        }}
        onRepeatModeChange={(mode: ListeningRepeatMode) => {
          void perform(() => runtime.setRepeatMode(mode))
        }}
        onSelect={(optionId) => {
          void perform(() => runtime.select(optionId))
        }}
        onDictationChange={(value) => {
          void perform(() => runtime.changeDictation(value))
        }}
        onSubmit={() => {
          void perform(() => runtime.submit())
        }}
        onAdvance={() => {
          void perform(() => runtime.advance())
        }}
        onResume={() => {
          void perform(() => runtime.resume())
        }}
      />
    </>
  )
}
