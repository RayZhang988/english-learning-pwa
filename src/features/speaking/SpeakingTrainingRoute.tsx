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
  type MicrophonePermissionService,
  type NetworkStatus,
  type NetworkStatusService,
} from '../../platform/index.ts'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineNotice,
} from '../../ui/index.ts'
import {
  currentSpeakingContentSource,
} from './content-source.ts'
import type { SpeakingRecognitionPort } from './types.ts'
import type { SpeakingRecordingPort } from './types.ts'
import type {
  SpeakingCatalog,
  SpeakingSession,
} from './types.ts'
import { SpeakingSessionRepository } from './repository.ts'
import { SpeakingRuntimeMountLifecycle } from './route-lifecycle.ts'
import { SpeakingTrainingRuntime } from './runtime.ts'
import { SpeakingSessionScreen } from './SpeakingSessionScreen.tsx'
import { getSpeakingSessionResult } from './session.ts'
import type {
  SpeakingEffectiveTimingSessionFactoryPort,
} from './timing.ts'
import type { SpeakingSupplyProvider } from './supply.ts'

export interface SpeakingTrainingRouteProps {
  readonly task: LearningTask
  readonly localDate: string
  readonly eventSink: PlatformEventSink
  readonly onExit: () => void
  readonly onCompleted?: (session: SpeakingSession) => void
  readonly contentSource?: ReadonlyDataSource<SpeakingCatalog>
  readonly repository?: SpeakingSessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly microphonePermission?: MicrophonePermissionService
  readonly recorder?: SpeakingRecordingPort
  readonly recognition?: SpeakingRecognitionPort
  readonly now?: () => string
  readonly createId?: () => string
  readonly timingSessionFactory?: SpeakingEffectiveTimingSessionFactoryPort
  readonly supplyProvider?: SpeakingSupplyProvider
  readonly trainingBudgetStatus?: () => 'running' | 'finish-current-item'
}

export function SpeakingTrainingRoute(
  props: SpeakingTrainingRouteProps,
) {
  const networkStatus = props.networkStatus ?? browserNetworkStatus
  const [network, setNetwork] = useState<NetworkStatus>(() =>
    networkStatus.current(),
  )
  const [state, setState] = useState<AsyncDataState<SpeakingSession>>({
    status: 'loading',
  })
  const operationPendingRef = useRef(false)
  const exitPendingRef = useRef(false)
  const runtimeKey = `${props.task.planId}:${props.task.taskId}`
  const runtimeRef = useRef<{
    readonly key: string
    readonly runtime: SpeakingTrainingRuntime
    readonly timingSessionFactory:
      | SpeakingEffectiveTimingSessionFactoryPort
      | undefined
  } | null>(null)
  const runtimeMountLifecycleRef =
    useRef<SpeakingRuntimeMountLifecycle | null>(null)
  const completedTaskRef = useRef<string | null>(null)
  if (!runtimeMountLifecycleRef.current) {
    runtimeMountLifecycleRef.current =
      new SpeakingRuntimeMountLifecycle()
  }

  if (
    runtimeRef.current?.key !== runtimeKey ||
    runtimeRef.current.timingSessionFactory !==
      props.timingSessionFactory
  ) {
    runtimeRef.current = {
      key: runtimeKey,
      timingSessionFactory: props.timingSessionFactory,
      runtime: new SpeakingTrainingRuntime({
        task: props.task,
        localDate: props.localDate,
        contentSource:
          props.contentSource ?? currentSpeakingContentSource,
        eventSink: props.eventSink,
        repository: props.repository,
        networkStatus,
        microphonePermission: props.microphonePermission,
        recorder: props.recorder,
        recognition: props.recognition,
        now: props.now,
        createId: props.createId,
        timingSessionFactory: props.timingSessionFactory,
        supplyProvider: props.supplyProvider,
        trainingBudgetStatus: props.trainingBudgetStatus,
      }),
    }
  }
  const runtime = runtimeRef.current.runtime

  const showSession = useCallback((session: SpeakingSession) => {
    setState({ status: 'ready', value: session })
  }, [])
  const showError = useCallback((error: unknown) => {
    setState({
      status: 'error',
      error:
        error instanceof Error
          ? error
          : new Error('口语训练发生未知错误。'),
    })
  }, [])
  const perform = useCallback(
    async (operation: () => Promise<SpeakingSession>) => {
      if (operationPendingRef.current) {
        return
      }
      operationPendingRef.current = true
      try {
        showSession(await operation())
      } catch (error) {
        showError(error)
      } finally {
        operationPendingRef.current = false
      }
    },
    [showError, showSession],
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
        (session.phase === 'practicing' ||
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
          (session.phase === 'practicing' ||
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
    return <LoadingState label="正在加载口语训练" />
  }
  if (state.status === 'empty') {
    return (
      <EmptyState
        title="没有可用的口语任务"
        description="学习计划暂未下发口语任务。"
      />
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="口语训练暂时无法继续"
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
          title="本次口语任务无法加载"
          description={
            session.failure?.message ?? '口语任务遇到内容错误。'
          }
          onRetry={retry}
        />
      </>
    )
  }
  if (session.phase === 'completed') {
    const result = getSpeakingSessionResult(session)
    return (
      <EmptyState
        title="口语练习已结束"
        description={
          result.performanceScore === null
            ? '录音练习已走完，但识别不可用，本次没有评分。'
            : `已完成 ${result.promptCount} 个固定口语提示，结果已上报。`
        }
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

  const recorderAction = () => {
    if (session.recorder.status === 'recording') {
      void perform(() => runtime.stopRecording())
    } else {
      void perform(() => runtime.startRecording())
    }
  }
  const primaryAction = () => {
    if (session.phase === 'paused') {
      void perform(() => runtime.resume())
    } else if (session.phase === 'feedback') {
      void perform(() => runtime.advance())
    } else if (
      session.recorder.status === 'unavailable' ||
      session.recorder.status === 'error'
    ) {
      void perform(() => runtime.continueWithoutRecording())
    }
  }

  return (
    <>
      {network === 'offline' ? <OfflineNotice /> : null}
      <SpeakingSessionScreen
        session={session}
        onExit={exit}
        onRecorderAction={recorderAction}
        onPlayback={() => {
          void perform(() => runtime.playRecording())
        }}
        onAction={primaryAction}
      />
    </>
  )
}
