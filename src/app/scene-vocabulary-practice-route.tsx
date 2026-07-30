import { useEffect, useRef, useState } from 'react'
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

export interface SceneVocabularyPracticeRouteHostProps {
  /** Test-only seams; production always uses the released source and browser speech. */
  readonly contentSource?: ReadonlyDataSource<SceneVocabularyQuestionBank>
  readonly speech?: SceneVocabularySpeechPort
  readonly createRuntime?: (
    options: SceneVocabularyPracticeRuntimeOptions,
  ) => SceneVocabularyPracticeRuntime
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

/**
 * A dedicated route keeps R13-B snapshots outside daily and optional training.
 * The only speech request forwarded from the screen is the highlighted target.
 */
export function SceneVocabularyPracticeRouteHost({
  contentSource = sceneVocabularyContentSource,
  speech = browserListeningSpeech,
  createRuntime = (options) => new SceneVocabularyPracticeRuntime(options),
}: SceneVocabularyPracticeRouteHostProps) {
  const navigate = useNavigate()
  const { category: categoryId, scene: sceneId } = useParams()
  const identity = categoryId && sceneId ? `${categoryId}:${sceneId}` : null
  const runtimeRef = useRef<{
    readonly identity: string
    readonly runtime: SceneVocabularyPracticeRuntime
  } | null>(null)
  const busyRef = useRef(false)
  const [snapshot, setSnapshot] = useState<SceneVocabularyPracticeSnapshot>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [restored, setRestored] = useState(false)

  const routeScene = sceneId ? getTravelScene(sceneId) : undefined
  const isKnownScene =
    categoryId !== undefined &&
    routeScene !== undefined &&
    routeScene.category.id === categoryId

  if (identity && runtimeRef.current?.identity !== identity) {
    runtimeRef.current = {
      identity,
      runtime: createRuntime({ categoryId: categoryId!, sceneId: sceneId!, contentSource }),
    }
  }

  const runtime = runtimeRef.current?.runtime

  const initialize = () => {
    if (!runtime) {
      return
    }
    busyRef.current = true
    setLoading(true)
    setError(undefined)
    void runtime.initialize().then(
      (next) => {
        setSnapshot(next)
        setRestored(next.answers.length > 0)
      },
      (reason: unknown) => setError(
        reason instanceof Error ? reason : new Error(errorMessage(reason)),
      ),
    ).finally(() => {
      busyRef.current = false
      setLoading(false)
    })
  }

  useEffect(() => {
    setSnapshot(undefined)
    setRestored(false)
    initialize()
    // The route identity is the session identity. Dependencies are injected only
    // once per mounted host, including in the test harness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])

  const run = (operation: () => Promise<SceneVocabularyPracticeSnapshot>) => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setError(undefined)
    void operation().then(
      (next) => setSnapshot(next),
      (reason: unknown) => setError(
        reason instanceof Error ? reason : new Error(errorMessage(reason)),
      ),
    ).finally(() => {
      busyRef.current = false
    })
  }

  const exitPath = categoryId
    ? `/practice/scenes/${encodeURIComponent(categoryId)}`
    : '/practice/scenes'
  const onExit = () => navigate(exitPath)

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
  if (loading && !snapshot && !error) {
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
  if (error || !snapshot) {
    return <SceneVocabularyPracticeScreen
      presentation={{
        status: 'error',
        description: error?.message ?? '场景词汇练习暂时无法恢复。',
      }}
      sceneTitle={routeScene.scene.title}
      onExit={onExit}
      onOptionSelected={() => undefined}
      onSubmit={() => undefined}
      onContinue={() => undefined}
      onTargetPlayback={() => undefined}
      onRetry={initialize}
    />
  }

  return <SceneVocabularyPracticeScreen
    presentation={{
      status: 'ready',
      view: runtime.toView(),
      recoveryNotice: restored ? recoveryNotice(snapshot) : undefined,
    }}
    sceneTitle={routeScene.scene.title}
    onExit={onExit}
    onOptionSelected={(optionId) => run(() => runtime.select(optionId))}
    onSubmit={() => run(() => runtime.submit())}
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
