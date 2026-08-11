import type {
  FeedbackViewModel,
  SpeakingContentMatchViewModel,
  SpeakingScreenViewModel,
} from '../../ui/index.ts'
import { SpeakingError } from './errors.ts'
import { getCurrentSpeakingPrompt } from './session.ts'
import type {
  SpeakingAnswerRecord,
  SpeakingSession,
} from './types.ts'

function modeLabel(session: SpeakingSession): string {
  if (session.task.mode === 'review') {
    return '口语复习'
  }
  if (session.task.mode === 'retry') {
    return '口语重试'
  }
  if (session.task.mode === 'calibration') {
    return '口语校准'
  }
  return '口语学习'
}

function durationLabel(durationMs: number): string | undefined {
  if (durationMs <= 0) {
    return undefined
  }
  return `${Math.max(1, Math.round(durationMs / 1_000))} 秒`
}

function recorderStatusLabel(session: SpeakingSession): string {
  switch (session.recorder.status) {
    case 'permission':
      return '需要麦克风权限'
    case 'ready':
      return '准备录音'
    case 'recording':
      return '正在录音'
    case 'processing':
      return session.recorder.message ?? '正在处理'
    case 'review':
      return '录音完成'
    case 'unavailable':
      return '录音不可用'
    default:
      return '录音发生错误'
  }
}

function matchFeedback(
  answer: SpeakingAnswerRecord,
): FeedbackViewModel | undefined {
  const match = answer.match
  if (match) {
    const description =
      '请在下方对照目标表达和实际识别文本。本结果只比较课程目标内容，不是发音评分。'
    if (match.level === 'match') {
      return {
        tone: 'success',
        title: '识别文本与目标表达一致',
        description,
      }
    }
    if (match.level === 'close') {
      return {
        tone: 'info',
        title: '识别文本与目标表达较接近',
        description,
      }
    }
    if (match.level === 'partial') {
      return {
        tone: 'correction',
        title: '识别到部分目标表达',
        description,
      }
    }
    return {
      tone: 'correction',
      title: '识别文本与目标表达差异较大',
      description,
    }
  }
  if (answer.recorded) {
    return {
      tone: 'device',
      title: '文本识别不可用，录音仍可回放',
      description:
        '请回放录音并对照示范表达自查。本题不生成文本接近度，也不记为答错。',
    }
  }
  return {
    tone: 'device',
    title: '没有可评分的口语证据',
    description:
      '麦克风不可用时无法录音或回放。本题可以继续，但不会记为答错。',
  }
}

function contentMatchViewModel(
  answer: SpeakingAnswerRecord | undefined,
  defaultTargetText: string,
  targetTranslationZh: string,
): SpeakingContentMatchViewModel | undefined {
  if (!answer) {
    return undefined
  }
  if (!answer.match) {
    return {
      state: 'unscorable',
      targetText: defaultTargetText,
      targetTranslationZh,
      recognizedText: null,
      resultLabel: '本次无法判断内容是否说对',
      guidance: answer.recorded
        ? '录音已经保留，请回放并对照目标表达自查。'
        : '本次没有取得录音或识别文本，因此不会记为答错。',
    }
  }

  const guidance = {
    match: '识别文本包含完整目标表达，可以继续。',
    close: '表达内容基本完整，存在少量文字差异。',
    partial: '只识别到部分目标内容，建议对照目标表达再说一次。',
    different: '识别文本与目标表达差异较大，建议重新检查表达内容。',
  } as const
  const resultLabel = {
    match: '内容一致',
    close: '内容大致一致',
    partial: '只匹配到部分内容',
    different: '内容差异较大',
  } as const

  return {
    state: 'recognized',
    targetText: answer.match.closestAcceptedAnswer,
    targetTranslationZh,
    recognizedText: answer.match.transcript,
    level: answer.match.level,
    resultLabel: resultLabel[answer.match.level],
    guidance: guidance[answer.match.level],
  }
}

export function toSpeakingScreenViewModel(
  session: SpeakingSession,
): SpeakingScreenViewModel {
  const prompt = getCurrentSpeakingPrompt(session)
  if (
    !prompt ||
    (session.phase !== 'practicing' &&
      session.phase !== 'feedback' &&
      session.phase !== 'paused')
  ) {
    throw new SpeakingError(
      'session-transition-invalid',
      'Only an active speaking session has a training ViewModel.',
    )
  }
  const currentAnswer = session.answers.find(
    (answer) => answer.promptId === prompt.id,
  )
  const recorderUnavailable =
    session.recorder.status === 'unavailable' ||
    session.recorder.status === 'error'
  const isLastPrompt =
    session.unit !== null &&
    session.promptIndex + 1 === session.unit.prompts.length
  const action =
    session.phase === 'paused'
      ? { label: '继续训练' }
      : session.phase === 'feedback'
        ? {
            label: isLastPrompt ? '完成训练' : '下一题',
          }
        : recorderUnavailable
          ? { label: '继续（本题不评分）' }
          : {
              label: '完成录音后继续',
              disabled: true,
            }
  const recorderStatus =
    session.phase === 'paused'
      ? 'processing'
      : session.recorder.status

  return {
    header: {
      eyebrow: modeLabel(session),
      title: '口语训练',
      progress: {
        label:
          `已完成 ${session.answers.length} / ` +
          `${session.unit?.prompts.length ?? 0}`,
        value: Math.round(
          (session.answers.length /
            Math.max(1, session.unit?.prompts.length ?? 1)) *
            100,
        ),
      },
    },
    instruction:
      session.unit?.instructionsZh ?? '按提示完成口语练习。',
    prompt: 'Respond in English',
    cueZh: prompt.cueZh,
    partnerLine: prompt.partnerLine,
    modelAnswer: prompt.modelAnswer,
    contentMatch: contentMatchViewModel(
      currentAnswer,
      prompt.modelAnswer,
      prompt.modelAnswerTranslationZh,
    ),
    recorder: {
      status: recorderStatus,
      statusLabel:
        session.phase === 'paused'
          ? '训练已暂停'
          : recorderStatusLabel(session),
      timeLabel: durationLabel(session.recorder.durationMs),
      description:
        session.recorder.message ??
        session.recognition.message ??
        undefined,
      playbackAvailable: session.recorder.playbackAvailable,
    },
    feedback: currentAnswer
      ? matchFeedback(currentAnswer)
      : session.recorder.status === 'unavailable' ||
          session.recorder.status === 'error'
        ? {
            tone: 'device',
            title: '当前无法录音',
            description:
              session.recorder.message ??
              '可以继续本题，但不会生成评分。',
          }
        : undefined,
    action,
    secondaryActionLabel:
      session.phase === 'feedback' && session.recorder.playbackAvailable
        ? '播放示范原句'
        : undefined,
  }
}
