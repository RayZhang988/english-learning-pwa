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
} from '../../ui/index.ts'
import {
  currentVocabularyContentSource,
} from './content-source.ts'
import { VocabularySessionScreen } from './VocabularySessionScreen.tsx'
import { VocabularySessionRepository } from './repository.ts'
import { VocabularyRuntimeMountLifecycle } from './route-lifecycle.ts'
import {
  VocabularyTrainingRuntime,
} from './runtime.ts'
import type {
  VocabularyEffectiveTimingSessionFactoryPort,
} from './timing.ts'
import type {
  VocabularyCatalog,
  VocabularySession,
} from './types.ts'

export interface VocabularyTrainingRouteProps {
  readonly task: LearningTask
  readonly localDate: string
  readonly eventSink: PlatformEventSink
  readonly onExit: () => void
  readonly onCompleted?: (session: VocabularySession) => void
  readonly contentSource?: ReadonlyDataSource<VocabularyCatalog>
  readonly repository?: VocabularySessionRepository
  readonly networkStatus?: NetworkStatusService
  readonly now?: () => string
  readonly createId?: () => string
  readonly timingSessionFactory?: VocabularyEffectiveTimingSessionFactoryPort
}

export function VocabularyTrainingRoute(
  props: VocabularyTrainingRouteProps,
) {
  const onCompleted = props.onCompleted
  const onExit = props.onExit
  const networkStatus = props.networkStatus ?? browserNetworkStatus
  const [network, setNetwork] = useState<NetworkStatus>(() =>
    networkStatus.current(),
  )
  const [state, setState] = useState<AsyncDataState<VocabularySession>>({
    status: 'loading',
  })
  const [operationPending, setOperationPending] = useState(false)
  const operationPendingRef = useRef(false)
  const exitPendingRef = useRef(false)
  const onCompletedRef = useRef(onCompleted)
  onCompletedRef.current = onCompleted
  const runtimeKey = `${props.task.planId}:${props.task.taskId}`
  const runtimeRef = useRef<{
    readonly key: string
    readonly runtime: VocabularyTrainingRuntime
    readonly timingSessionFactory:
      | VocabularyEffectiveTimingSessionFactoryPort
      | undefined
  } | null>(null)
  const runtimeMountLifecycleRef =
    useRef<VocabularyRuntimeMountLifecycle | null>(null)
  const completedTaskRef = useRef<string | null>(null)
  if (!runtimeMountLifecycleRef.current) {
    runtimeMountLifecycleRef.current =
      new VocabularyRuntimeMountLifecycle()
  }

  if (
    runtimeRef.current?.key !== runtimeKey ||
    runtimeRef.current.timingSessionFactory !== props.timingSessionFactory
  ) {
    runtimeRef.current = {
      key: runtimeKey,
      timingSessionFactory: props.timingSessionFactory,
      runtime: new VocabularyTrainingRuntime({
        task: props.task,
        localDate: props.localDate,
        contentSource:
          props.contentSource ?? currentVocabularyContentSource,
        eventSink: props.eventSink,
        repository: props.repository,
        networkStatus,
        now: props.now,
        createId: props.createId,
        timingSessionFactory: props.timingSessionFactory,
      }),
    }
  }
  const runtime = runtimeRef.current.runtime

  const showSession = useCallback((session: VocabularySession) => {
    setState({ status: 'ready', value: session })
  }, [])

  const showError = useCallback((error: unknown) => {
    setState({
      status: 'error',
      error:
        error instanceof Error
          ? error
          : new Error('词汇训练发生未知错误。'),
    })
  }, [])

  const notifyCompleted = useCallback(
    (session: VocabularySession) => {
      if (
        session.phase === 'completed' &&
        completedTaskRef.current !== session.task.taskId
      ) {
        completedTaskRef.current = session.task.taskId
        onCompletedRef.current?.(session)
      }
    },
    [],
  )

  const perform = useCallback(
    async (operation: () => Promise<VocabularySession>) => {
      if (operationPendingRef.current) {
        return
      }
      operationPendingRef.current = true
      setOperationPending(true)
      try {
        notifyCompleted(await operation())
      } catch (error) {
        showError(error)
      } finally {
        operationPendingRef.current = false
        setOperationPending(false)
      }
    },
    [notifyCompleted, showError],
  )

  useEffect(
    () => runtime.subscribe(showSession),
    [runtime, showSession],
  )

  useEffect(() => {
    let active = true
    const releaseRuntime =
      runtimeMountLifecycleRef.current!.retain(runtime)
    setState({ status: 'loading' })
    void runtime.initialize().then(
      (session) => {
        if (active) {
          notifyCompleted(session)
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
  }, [notifyCompleted, runtime, showError])

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
        (session.phase === 'answering' || session.phase === 'feedback')
      ) {
        void runtime.pauseIfActive('app-backgrounded').catch(showError)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener(
        'visibilitychange',
        onVisibilityChange,
      )
    }
  }, [runtime, showError])

  const retry = useCallback(() => {
    const session = runtime.currentSession
    if (session?.phase === 'error') {
      void perform(() => runtime.restart())
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
          (session.phase === 'answering' || session.phase === 'feedback')
        ) {
          await runtime.pauseIfActive('user-paused')
        }
        await runtime.dispose()
        onExit()
      } catch (error) {
        exitPendingRef.current = false
        showError(error)
      }
    })()
  }, [onExit, runtime, showError])

  if (state.status === 'loading' || state.status === 'idle') {
    return <LoadingState label="正在加载词汇训练" />
  }
  if (state.status === 'empty') {
    return (
      <EmptyState
        title="没有可用的词汇任务"
        description="学习计划暂未下发词汇任务。"
      />
    )
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="词汇训练暂时无法继续"
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
          title="本次词汇任务无法评分"
          description={
            session.failure?.message ?? '词汇任务遇到不可恢复的内容错误。'
          }
          onRetry={retry}
        />
      </>
    )
  }
  if (session.phase === 'completed') {
    return (
      <EmptyState
        title="词汇任务已完成"
        description={`已完成 ${session.questions.length} 道题，学习结果已上报。`}
        action={(
          <button
            className="primary-button"
            type="button"
            onClick={exit}
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
      <VocabularySessionScreen
        session={session}
        operationPending={operationPending}
        onExit={exit}
        onSelect={(optionId) => {
          void perform(() => runtime.select(optionId))
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
