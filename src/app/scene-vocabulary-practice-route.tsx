import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { ReadonlyDataSource } from '../core/index.ts'
import {
  SceneVocabularyPracticeRuntime,
  type SceneVocabularyPracticeRuntimeOptions,
  type SceneVocabularyPracticeSnapshot,
  type SceneVocabularyQuestionBank,
} from '../features/vocabulary/index.ts'
import {
  browserListeningSpeech,
} from '../features/listening/index.ts'
import {
  ErrorState,
  SceneVocabularyPracticeScreen,
  getTravelScene,
} from '../ui/index.ts'
import { sceneVocabularyContentSource } from './scene-vocabulary-content-source.ts'
import {
  playSceneVocabularyTarget,
  type SceneVocabularySpeechPort,
} from './scene-vocabulary-target-playback.ts'
import {
  SceneVocabularyRouteLifecycle,
} from './scene-vocabulary-route-lifecycle.ts'
import { productionWrongAnswerEvidencePorts } from './wrong-answer-evidence-production.ts'
import { useLearningApp } from './learning/learning-app-context.ts'

const createProductionSceneVocabularyRuntime = (
  options: SceneVocabularyPracticeRuntimeOptions,
) => new SceneVocabularyPracticeRuntime(options)

interface SceneVocabularyRouteState {
  readonly identity: string | null
  readonly loading: boolean
  readonly snapshot?: SceneVocabularyPracticeSnapshot
  readonly error?: Error
  readonly restored: boolean
  /** Deliberate entry choice for a durable scene-only session. */
  readonly resumeChoice?: boolean
  readonly invalidSnapshotRecoveryConfirmation?: boolean
  readonly invalidSnapshotRecoveryBusy?: boolean
  /** Mirrors a durable select intent until 06 returns its persisted snapshot. */
  readonly pendingSelectedOptionId?: string
}

const initialRouteState: SceneVocabularyRouteState = {
  identity: null,
  loading: false,
  restored: false,
}

export interface SceneVocabularyPracticeRouteHostProps {
  /** Test-only seams; production always uses the released source and browser speech. */
  readonly contentSource?: ReadonlyDataSource<SceneVocabularyQuestionBank>
  readonly speech?: SceneVocabularySpeechPort
  readonly createRuntime?: (
    options: SceneVocabularyPracticeRuntimeOptions,
  ) => SceneVocabularyPracticeRuntime
  readonly readyWrongAnswerReview?: SceneVocabularyPracticeRuntimeOptions['wrongAnswerReview']
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : '场景词汇练习暂时无法恢复。'
}

function recoveryNotice(snapshot: SceneVocabularyPracticeSnapshot) {
  if (snapshot.answers.length === 0) {
    return undefined
  }
  return {
    title: '已恢复上次练习',
    description: `已答 ${snapshot.answers.length} 题，继续完成本场练习。`,
  }
}

function hasResumableSceneProgress(snapshot: SceneVocabularyPracticeSnapshot): boolean {
  return snapshot.answers.length > 0 || snapshot.selectedOptionId !== null
}

function isInvalidSnapshotError(error: Error | undefined): boolean {
  return (error as { readonly code?: unknown } | undefined)?.code ===
    'session-recovery-invalid'
}

/**
 * A dedicated route keeps R13-B snapshots outside daily and optional training.
 * The only speech request forwarded from the screen is the highlighted target.
 */
export function SceneVocabularyPracticeRouteHost({
  contentSource = sceneVocabularyContentSource,
  speech = browserListeningSpeech,
  createRuntime = createProductionSceneVocabularyRuntime,
  readyWrongAnswerReview,
}: SceneVocabularyPracticeRouteHostProps) {
  const { coordinator } = useLearningApp()
  const navigate = useNavigate()
  const { category: categoryId, scene: sceneId } = useParams()
  const identity = categoryId && sceneId ? `${categoryId}:${sceneId}` : null
  const lifecycleRef = useRef(new SceneVocabularyRouteLifecycle())
  const operationCountsRef = useRef(new Map<number, number>())
  const selectionPendingRef = useRef<string | undefined>(undefined)
  const submitPendingRef = useRef(false)
  const [routeState, setRouteState] =
    useState<SceneVocabularyRouteState>(initialRouteState)
  const [retryRevision, setRetryRevision] = useState(0)
  const [reviewState, setReviewState] = useState<'loading' | 'ready' | 'error'>(
    readyWrongAnswerReview ? 'ready' : 'loading',
  )
  useEffect(() => {
    if (readyWrongAnswerReview) return
    let current = true
    void productionWrongAnswerEvidencePorts.initialize().then(
      () => { if (current) setReviewState('ready') },
      () => { if (current) setReviewState('error') },
    )
    return () => { current = false }
  }, [readyWrongAnswerReview])
  const wrongAnswerReview = useMemo(
    () => readyWrongAnswerReview ??
      (reviewState === 'ready'
        ? productionWrongAnswerEvidencePorts.vocabulary
        : undefined),
    [readyWrongAnswerReview, reviewState],
  )

  const routeScene = sceneId ? getTravelScene(sceneId) : undefined
  const isKnownScene =
    categoryId !== undefined &&
    routeScene !== undefined &&
    routeScene.category.id === categoryId

  const runtime = useMemo(
    () =>
      isKnownScene && categoryId && sceneId && identity && wrongAnswerReview
        ? createRuntime({
            categoryId,
            sceneId,
            contentSource,
            wrongAnswerReview,
            onTrainingItemCompleted: (completion) =>
              coordinator.acknowledgeSceneTrainingItem(completion),
          })
        : undefined,
    [categoryId, contentSource, coordinator, createRuntime, identity, isKnownScene, sceneId, wrongAnswerReview],
  )

  useEffect(() => {
    if (!identity || !runtime) {
      setRouteState({
        identity,
        loading: false,
        restored: false,
      })
      return undefined
    }
    const lifecycle = lifecycleRef.current
    const token = lifecycle.begin(identity)
    selectionPendingRef.current = undefined
    submitPendingRef.current = false
    setRouteState({ identity, loading: true, restored: false })

    void runtime.initialize().then(
      (snapshot) => {
        if (!lifecycle.isCurrent(token)) {
          return
        }
        setRouteState({
          identity,
          loading: false,
          snapshot,
          restored: hasResumableSceneProgress(snapshot),
          resumeChoice: hasResumableSceneProgress(snapshot),
        })
      },
      (reason: unknown) => {
        if (!lifecycle.isCurrent(token)) {
          return
        }
        setRouteState({
          identity,
          loading: false,
          restored: false,
          error: reason instanceof Error ? reason : new Error(errorMessage(reason)),
        })
      },
    ).finally(() => {
      operationCountsRef.current.delete(token.generation)
    })

    return () => lifecycle.invalidate(token)
  }, [identity, retryRevision, runtime])

  const run = (
    operation: () => Promise<SceneVocabularyPracticeSnapshot>,
    options: {
      readonly allowAfterSelection?: boolean
      readonly preserveError?: boolean
      readonly onSettled?: () => void
    } = {},
  ): boolean => {
    const token = identity
      ? lifecycleRef.current.currentFor(identity)
      : undefined
    if (!token) {
      return false
    }
    const queued = operationCountsRef.current.get(token.generation) ?? 0
    if (queued > 0 && !options.allowAfterSelection) {
      return false
    }
    operationCountsRef.current.set(token.generation, queued + 1)
    if (!options.preserveError) {
      setRouteState((current) =>
        current.identity === token.identity
          ? { ...current, error: undefined }
          : current,
      )
    }
    void operation().then(
      (snapshot) => {
        if (!lifecycleRef.current.isCurrent(token)) {
          return
        }
        setRouteState((current) =>
          current.identity === token.identity
            ? {
                ...current,
                snapshot,
                error: undefined,
                loading: false,
                resumeChoice: false,
                invalidSnapshotRecoveryConfirmation: false,
                invalidSnapshotRecoveryBusy: false,
                pendingSelectedOptionId: undefined,
              }
            : current,
        )
      },
      (reason: unknown) => {
        if (!lifecycleRef.current.isCurrent(token)) {
          return
        }
        setRouteState((current) =>
          current.identity === token.identity
            ? {
                ...current,
                error: reason instanceof Error
                  ? reason
                  : new Error(errorMessage(reason)),
                invalidSnapshotRecoveryBusy: false,
              }
            : current,
        )
      },
    ).finally(() => {
      const pending = operationCountsRef.current.get(token.generation) ?? 0
      if (pending <= 1) {
        operationCountsRef.current.delete(token.generation)
      } else {
        operationCountsRef.current.set(token.generation, pending - 1)
      }
      if (lifecycleRef.current.isCurrent(token)) {
        options.onSettled?.()
      }
    })
    return true
  }

  const exitPath = categoryId
    ? `/practice/scenes/${encodeURIComponent(categoryId)}`
    : '/practice/scenes'
  const exitPendingRef = useRef(false)
  const onExit = () => {
    if (exitPendingRef.current) {
      return
    }
    exitPendingRef.current = true
    const token = identity
      ? lifecycleRef.current.currentFor(identity)
      : undefined
    if (!token) {
      exitPendingRef.current = false
      navigate(exitPath)
      return
    }
    void runtime?.exit().then(
      () => {
        if (lifecycleRef.current.isCurrent(token)) {
          navigate(exitPath)
        }
      },
      (reason: unknown) => {
        exitPendingRef.current = false
        if (lifecycleRef.current.isCurrent(token)) {
          setRouteState((current) => current.identity === token.identity
            ? {
                ...current,
                error: reason instanceof Error
                  ? reason
                  : new Error(errorMessage(reason)),
              }
            : current)
        }
      },
    )
  }

  if (isKnownScene && categoryId && sceneId && reviewState === 'loading') {
    return <SceneVocabularyPracticeScreen
      presentation={{ status: 'loading', label: '正在准备统一错题库' }}
      sceneTitle={routeScene.scene.title}
      onExit={onExit}
      onOptionSelected={() => undefined}
      onSubmit={() => undefined}
      onContinue={() => undefined}
      onTargetPlayback={() => undefined}
    />
  }
  if (isKnownScene && categoryId && sceneId && reviewState === 'error') {
    return <main className="full-page-feedback"><ErrorState
      title="无法准备错题库"
      description="正式错题无法保存，场景训练已暂停。"
      onRetry={() => {
        setReviewState('loading')
        void productionWrongAnswerEvidencePorts.initialize().then(
          () => setReviewState('ready'),
          () => setReviewState('error'),
        )
      }}
    /></main>
  }
  if (!isKnownScene || !runtime || !categoryId || !sceneId) {
    return (
      <main className="full-page-feedback">
        <ErrorState
          title="找不到这个旅行场景"
          description="场景结构可能已经更新，请返回场景训练重新选择。"
          onRetry={onExit}
        />
      </main>
    )
  }
  const stateMatchesRoute = routeState.identity === identity
  if (!stateMatchesRoute || routeState.loading) {
    return <SceneVocabularyPracticeScreen
      presentation={{ status: 'loading', label: '正在准备场景词汇练习' }}
      sceneTitle={routeScene.scene.title}
      onExit={onExit}
      onOptionSelected={() => undefined}
      onSubmit={() => undefined}
      onContinue={() => undefined}
      onTargetPlayback={() => undefined}
    />
  }
  if (routeState.error || !routeState.snapshot) {
    const invalidSnapshot = isInvalidSnapshotError(routeState.error)
    return <SceneVocabularyPracticeScreen
      presentation={{
        status: 'error',
        title: invalidSnapshot ? '无法恢复此场景训练' : undefined,
        description: invalidSnapshot
          ? '此场景保存的训练数据不完整或已与当前课程不匹配。不会自动删除它。'
          : routeState.error?.message ?? '场景词汇练习暂时无法恢复。',
        invalidSnapshotRecovery: invalidSnapshot
          ? {
              confirming: routeState.invalidSnapshotRecoveryConfirmation === true,
              busy: routeState.invalidSnapshotRecoveryBusy === true,
            }
          : undefined,
      }}
      sceneTitle={routeScene.scene.title}
      onExit={onExit}
      onOptionSelected={() => undefined}
      onSubmit={() => undefined}
      onContinue={() => undefined}
      onTargetPlayback={() => undefined}
      onRetry={invalidSnapshot
        ? undefined
        : () => setRetryRevision((current) => current + 1)}
      onRequestInvalidSnapshotRestart={() => setRouteState((current) =>
        current.identity === identity
          ? { ...current, invalidSnapshotRecoveryConfirmation: true }
          : current)}
      onCancelInvalidSnapshotRestart={() => setRouteState((current) =>
        current.identity === identity
          ? { ...current, invalidSnapshotRecoveryConfirmation: false }
          : current)}
      onConfirmInvalidSnapshotRestart={() => {
        if (!routeState.invalidSnapshotRecoveryConfirmation || routeState.invalidSnapshotRecoveryBusy) {
          return
        }
        setRouteState((current) => current.identity === identity
          ? { ...current, invalidSnapshotRecoveryBusy: true }
          : current)
        if (!run(
          () => runtime.restartAfterInvalidSnapshot(),
          { preserveError: true },
        )) {
          setRouteState((current) => current.identity === identity
            ? { ...current, invalidSnapshotRecoveryBusy: false }
            : current)
        }
      }}
    />
  }

  const view = runtime.toView()
  const displayView =
    routeState.pendingSelectedOptionId && view.status === 'question' && view.question
      ? {
          ...view,
          question: {
            ...view.question,
            options: view.question.options.map((option) => ({
              ...option,
              state: option.id === routeState.pendingSelectedOptionId
                ? 'selected' as const
                : 'default' as const,
            })),
          },
        }
      : view

  if (routeState.resumeChoice) {
    return <SceneVocabularyPracticeScreen
      presentation={{ status: 'resume-choice', view: displayView }}
      sceneTitle={routeScene.scene.title}
      onExit={onExit}
      onOptionSelected={() => undefined}
      onSubmit={() => undefined}
      onContinue={() => undefined}
      onResumePrevious={() => setRouteState((current) =>
        current.identity === identity
          ? { ...current, resumeChoice: false }
          : current)}
      onStartNewRound={() => run(() => runtime.startNewRound())}
      onTargetPlayback={() => undefined}
    />
  }

  return <SceneVocabularyPracticeScreen
    presentation={{
      status: 'ready',
      view: displayView,
      recoveryNotice: routeState.restored
        ? recoveryNotice(routeState.snapshot)
        : undefined,
    }}
    sceneTitle={routeScene.scene.title}
    onExit={onExit}
    onOptionSelected={(optionId) => {
      if (selectionPendingRef.current) {
        return
      }
      if (run(
        () => runtime.select(optionId),
        {
          onSettled: () => {
            selectionPendingRef.current = undefined
          },
        },
      )) {
        selectionPendingRef.current = optionId
        setRouteState((current) =>
          current.identity === identity
            ? { ...current, pendingSelectedOptionId: optionId }
            : current,
        )
      }
    }}
    onSubmit={() => {
      if (submitPendingRef.current) {
        return
      }
      const queuedAfterSelection = selectionPendingRef.current !== undefined
      if (run(
        () => runtime.submit(),
        {
          allowAfterSelection: queuedAfterSelection,
          onSettled: () => {
            submitPendingRef.current = false
            selectionPendingRef.current = undefined
          },
        },
      )) {
        submitPendingRef.current = true
      }
    }}
    onContinue={() => run(() => runtime.advance())}
    onTargetPlayback={(intent) => {
      try {
        playSceneVocabularyTarget(speech, intent)
      } catch {
        // Playback support is an enhancement. A failed device voice must not
        // destroy an already persisted question or alter its score.
      }
    }}
  />
}
