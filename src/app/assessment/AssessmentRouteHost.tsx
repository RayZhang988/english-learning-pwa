import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  placementBankV1,
  toPublicAssessmentItem,
  type AssessmentRuntimeState,
  type PublicAssessmentItem,
} from '../../features/assessment/index.ts'
import {
  browserListeningSpeech,
  type ListeningSpeechPort,
} from '../../features/listening/index.ts'
import {
  AssessmentChoiceScreen,
  AssessmentIntroScreen,
  AssessmentPausedScreen,
  AssessmentResultsScreen,
  AssessmentSpeechScreen,
  EmptyState,
  ErrorState,
  LoadingState,
  type AudioPlayerViewModel,
  type RecorderViewModel,
} from '../../ui/index.ts'
import {
  AssessmentCaptureController,
  type AssessmentCaptureState,
} from './assessment-capture-controller.ts'
import { browserNetworkStatus } from '../../platform/index.ts'
import { createAssessmentSpeechObservation } from './assessment-speech-observation.ts'
import {
  assessmentAppCoordinator,
  type AssessmentAppCoordinator,
  type AssessmentAppState,
} from './assessment-app-coordinator.ts'
import {
  assessmentIntroViewModel,
  toAssessmentPausedViewModel,
  toAssessmentQuestionViewModel,
  toAssessmentResultsViewModel,
} from './assessment-view-model.ts'

function publicItem(itemId: string): PublicAssessmentItem | null {
  const item = placementBankV1.items.find(
    (candidate) => candidate.id === itemId,
  )
  return item ? toPublicAssessmentItem(item) : null
}

function presentationItem(
  state: AssessmentRuntimeState,
): PublicAssessmentItem | null {
  if (state.item) {
    return state.item
  }
  return state.lastSubmission
    ? publicItem(state.lastSubmission.itemId)
    : null
}

function recorderViewModel(
  state: AssessmentCaptureState,
): RecorderViewModel {
  switch (state.status) {
    case 'permission':
      return {
        status: 'permission',
        statusLabel: '需要麦克风权限',
        description: '录音只在当前设备内处理；识别失败时可回放自查。',
      }
    case 'ready':
      return {
        status: 'ready',
        statusLabel: '准备录音',
        description: '点击麦克风后开始作答，完成后再次点击停止。',
      }
    case 'recording':
      return {
        status: 'recording',
        statusLabel: '正在录音',
        description: '说完后点击停止录音。',
      }
    case 'processing':
      return {
        status: 'processing',
        statusLabel: '正在处理录音',
        description: '录音不会上传到本应用的服务器。',
      }
    case 'review':
      return {
        status: 'review',
        statusLabel:
          state.result.recognition.status === 'recognized'
            ? '录音已就绪'
            : '识别失败，录音仍可回放',
        description:
          state.result.recognition.status === 'recognized'
            ? '可以提交本题，或重新录音。'
            : '本题不会按答错处理。',
        playbackAvailable: state.playbackAvailable,
      }
    case 'unavailable':
      return {
        status: 'unavailable',
        statusLabel: '麦克风或录音不可用',
        description: '可提交设备失败记录，系统不会猜测口语水平。',
        playbackAvailable: state.playbackAvailable,
      }
    case 'error':
      return {
        status: 'error',
        statusLabel: '录音失败',
        description: '可重试录音，或提交失败记录继续测试。',
        playbackAvailable: state.playbackAvailable,
      }
  }
}

export interface AssessmentRouteHostProps {
  readonly coordinator?: AssessmentAppCoordinator
  readonly createCaptureController?: () => AssessmentCaptureController
  readonly speech?: ListeningSpeechPort
}

export const ASSESSMENT_RESULTS_ROUTE = '/assessment?mode=results'

function createDefaultCaptureController() {
  return new AssessmentCaptureController()
}

export function AssessmentRouteHost({
  coordinator = assessmentAppCoordinator,
  createCaptureController = createDefaultCaptureController,
  speech = browserListeningSpeech,
}: AssessmentRouteHostProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const resultsMode = searchParams.get('mode') === 'results'
  const captureController = useMemo(
    createCaptureController,
    [createCaptureController],
  )
  const [state, setState] = useState<AssessmentAppState>(
    coordinator.state,
  )
  const [capture, setCapture] = useState<AssessmentCaptureState>(
    captureController.state,
  )
  const [busy, setBusy] = useState(false)
  const [audioStatus, setAudioStatus] =
    useState<AudioPlayerViewModel['status']>('idle')
  const [audioPlayCount, setAudioPlayCount] = useState(0)
  const audioGeneration = useRef(0)

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState)
    void coordinator.initialize()
    return unsubscribe
  }, [coordinator])

  useEffect(() => {
    const unsubscribe = captureController.subscribe(setCapture)
    void captureController.initialize()
    return () => {
      unsubscribe()
      captureController.dispose()
    }
  }, [captureController])

  useEffect(() => {
    if (state.status === 'profile-ready' && !resultsMode) {
      navigate('/', { replace: true })
    }
  }, [navigate, resultsMode, state])

  useEffect(
    () => () => {
      audioGeneration.current += 1
      speech.cancel()
    },
    [speech],
  )

  const run = async (operation: () => Promise<unknown>) => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      await operation()
    } finally {
      setBusy(false)
    }
  }

  if (state.status === 'loading') {
    return (
      <main className="full-page-feedback">
        <LoadingState label="正在恢复水平测试" />
      </main>
    )
  }
  if (state.status === 'profile-ready') {
    if (resultsMode) {
      return (
        <AssessmentResultsScreen
          viewModel={toAssessmentResultsViewModel(state.profile)}
          onContinue={() => navigate('/')}
          onExit={() => navigate('/')}
        />
      )
    }
    return (
      <main className="full-page-feedback">
        <LoadingState label="正在返回今日计划" />
      </main>
    )
  }
  if (state.status === 'error') {
    return (
      <main className="full-page-feedback">
        <ErrorState
          title="水平测试暂时无法继续"
          description={state.error.message}
          onRetry={() => {
            void (state.canRetryCompletion
              ? coordinator.retryCompletion()
              : coordinator.initialize())
          }}
        />
      </main>
    )
  }

  const runtime = state.runtime
  if (resultsMode && runtime.lifecycle !== 'completed') {
    return (
      <main className="full-page-feedback">
        <EmptyState
          title="还没有可查看的测试结果"
          description="请先完成当前水平测试；第一版不会从结果入口开始新的重复测试。"
          action={(
            <button
              className="primary-button"
              type="button"
              onClick={() => navigate('/')}
            >
              返回今日计划
            </button>
          )}
        />
      </main>
    )
  }
  if (runtime.lifecycle === 'intro') {
    return (
      <AssessmentIntroScreen
        viewModel={assessmentIntroViewModel}
        onStart={() => {
          void run(() => coordinator.start())
        }}
        onExit={() => navigate('/')}
      />
    )
  }
  if (runtime.lifecycle === 'paused') {
    return (
      <AssessmentPausedScreen
        viewModel={toAssessmentPausedViewModel(runtime, busy)}
        onExit={() => navigate('/')}
        onResume={(sessionId) => {
          if (sessionId === runtime.sessionId) {
            void run(() => coordinator.resume())
          }
        }}
        onStop={(sessionId) => {
          if (sessionId === runtime.sessionId) {
            void run(() => coordinator.stop())
          }
        }}
      />
    )
  }
  if (runtime.lifecycle === 'completed' && runtime.profile) {
    return (
      <AssessmentResultsScreen
        viewModel={toAssessmentResultsViewModel(runtime.profile)}
        onContinue={() => navigate('/')}
        onExit={() => navigate('/')}
      />
    )
  }

  const item = presentationItem(runtime)
  if (!item) {
    return (
      <main className="full-page-feedback">
        <ErrorState
          title="无法显示当前测试题"
          description="测试快照缺少当前题目标识，已停止继续作答以避免产生错误结果。"
          onRetry={() => {
            void coordinator.initialize()
          }}
        />
      </main>
    )
  }
  const question = toAssessmentQuestionViewModel(runtime, item, {
    audioStatus,
    audioPlayCount,
    recorder: recorderViewModel(capture),
    speechEvidenceReady: capture.result !== null,
    busy,
  })
  const targetMatches = (sessionId: string, itemId: string) =>
    sessionId === runtime.sessionId && itemId === item.id
  const pauseAndExit = async (sessionId: string) => {
    if (sessionId !== runtime.sessionId) {
      return
    }
    if (runtime.actions.canPause) {
      await coordinator.pause()
    }
    navigate('/')
  }
  const playAudio = async () => {
    const text = item.stimulus.audioText
    if (!text) {
      return
    }
    if (audioStatus === 'playing') {
      speech.pause()
      setAudioStatus('paused')
      return
    }
    if (audioStatus === 'paused') {
      speech.resume()
      setAudioStatus('playing')
      return
    }
    if (audioPlayCount >= item.stimulus.maxPlays) {
      return
    }
    if (!speech.capabilities().supported) {
      setAudioStatus('unavailable')
      await coordinator.reportItemFailure(
        item.id,
        'audio-unavailable',
      )
      return
    }
    setAudioStatus('playing')
    setAudioPlayCount((count) => count + 1)
    const generation = audioGeneration.current + 1
    audioGeneration.current = generation
    const isCurrent = () => audioGeneration.current === generation
    try {
      speech.speak(
        { text, locale: 'en-US', rate: 1 },
        {
          onPause: () => {
            if (isCurrent()) {
              setAudioStatus('paused')
            }
          },
          onResume: () => {
            if (isCurrent()) {
              setAudioStatus('playing')
            }
          },
          onEnd: () => {
            if (isCurrent()) {
              setAudioStatus('ended')
            }
          },
          onError: () => {
            if (!isCurrent()) {
              return
            }
            setAudioStatus('error')
            void coordinator.reportItemFailure(
              item.id,
              'audio-playback-failed',
            )
          },
        },
      )
    } catch {
      setAudioStatus('error')
      await coordinator.reportItemFailure(
        item.id,
        'audio-playback-failed',
      )
    }
  }
  const continueAssessment = async () => {
    audioGeneration.current += 1
    speech.cancel()
    captureController.reset()
    setAudioStatus('idle')
    setAudioPlayCount(0)
    await coordinator.continue()
  }

  if (question.kind === 'choice') {
    return (
      <AssessmentChoiceScreen
        viewModel={question.viewModel}
        onExit={(sessionId) => {
          void run(() => pauseAndExit(sessionId))
        }}
        onSelect={(intent) => {
          if (
            targetMatches(intent.sessionId, intent.itemId) &&
            runtime.actions.canSelectChoice
          ) {
            void run(() =>
              coordinator.selectChoice(intent.itemId, intent.optionId),
            )
          }
        }}
        onSubmit={(target) => {
          if (
            targetMatches(target.sessionId, target.itemId) &&
            runtime.actions.canSubmitChoice
          ) {
            void run(() => coordinator.submitChoice(target.itemId))
          }
        }}
        onContinue={(target) => {
          if (
            targetMatches(target.sessionId, target.itemId) &&
            runtime.actions.canContinue
          ) {
            void run(continueAssessment)
          }
        }}
        onSkip={(target) => {
          if (
            targetMatches(target.sessionId, target.itemId) &&
            runtime.actions.canSkip
          ) {
            void run(() => coordinator.skip(target.itemId))
          }
        }}
        onPause={(target) => {
          if (
            targetMatches(target.sessionId, target.itemId) &&
            runtime.actions.canPause
          ) {
            void run(() => coordinator.pause())
          }
        }}
        onToggleAudio={
          item.stimulus.audioText
            ? () => {
                void run(playAudio)
              }
            : undefined
        }
      />
    )
  }

  return (
    <AssessmentSpeechScreen
      viewModel={question.viewModel}
      onExit={(sessionId) => {
        void run(() => pauseAndExit(sessionId))
      }}
      onRecorderAction={(target) => {
        if (!targetMatches(target.sessionId, target.itemId)) {
          return
        }
        void run(() =>
          capture.status === 'recording'
            ? captureController.finish()
            : captureController.begin(),
        )
      }}
      onPlayback={(target) => {
        if (targetMatches(target.sessionId, target.itemId)) {
          void run(() => captureController.play())
        }
      }}
      onToggleAudio={
        item.stimulus.audioText
          ? (target) => {
              if (targetMatches(target.sessionId, target.itemId)) {
                void run(playAudio)
              }
            }
          : undefined
      }
      onSubmit={(target) => {
        if (!targetMatches(target.sessionId, target.itemId)) {
          return
        }
        const observation = createAssessmentSpeechObservation(
          item.id,
          capture,
          browserNetworkStatus.current() === 'online',
        )
        if (observation) {
          void run(() =>
            observation.status === 'scored'
              ? coordinator.submitSpeech(item.id, observation)
              : coordinator.reportRecognitionFailure(
                  item.id,
                  observation,
                ),
          )
        }
      }}
      onContinue={(target) => {
        if (
          targetMatches(target.sessionId, target.itemId) &&
          runtime.actions.canContinue
        ) {
          void run(continueAssessment)
        }
      }}
      onSkip={(target) => {
        if (
          targetMatches(target.sessionId, target.itemId) &&
          runtime.actions.canSkip
        ) {
          void run(() => coordinator.skip(item.id))
        }
      }}
      onPause={(target) => {
        if (
          targetMatches(target.sessionId, target.itemId) &&
          runtime.actions.canPause
        ) {
          void run(() => coordinator.pause())
        }
      }}
    />
  )
}
