import {
  CEFR_DISCLAIMER,
  INSUFFICIENT_EVIDENCE_MESSAGE,
  describeInternalLevel,
  type AbilityEstimate,
  type AbilityProfile,
  type AssessmentRuntimeState,
  type AssessmentSubmissionSummary,
  type PublicAssessmentItem,
} from '../../features/assessment/index.ts'
import type {
  AssessmentChoiceViewModel,
  AssessmentFallbackNoticeViewModel,
  AssessmentIntroViewModel,
  AssessmentLastSubmissionViewModel,
  AssessmentPausedViewModel,
  AssessmentResultsViewModel,
  AssessmentSpeechViewModel,
  AudioPlayerViewModel,
  FeedbackViewModel,
  RecorderViewModel,
  TrainingHeaderViewModel,
} from '../../ui/index.ts'

const domainLabels = {
  vocabulary: '词汇',
  listening: '听力',
  speaking: '口语',
} as const

export const assessmentIntroViewModel: AssessmentIntroViewModel = {
  title: '找到适合你的起点',
  description:
    '测试会分别估算词汇、听力和口语，结果只用于安排第一阶段学习。',
  durationLabel: '约 15–20 分钟',
  sections: [
    {
      id: 'vocabulary',
      label: '词汇',
      description: '词义与句子理解',
    },
    {
      id: 'listening',
      label: '听力',
      description: '主旨、细节与推断',
    },
    {
      id: 'speaking',
      label: '口语',
      description: '朗读、跟读与简单表达',
    },
  ],
  readinessNote:
    '开始前会检查音频和麦克风；识别失败时仍可回放录音。',
  disclaimer: CEFR_DISCLAIMER,
}

function questionInstruction(item: PublicAssessmentItem): string {
  switch (item.format) {
    case 'word-meaning':
    case 'sentence-understanding':
      return '选择最合适的答案'
    case 'listening-gist':
    case 'listening-detail':
    case 'listening-inference':
      return '先播放音频，再选择答案'
    case 'read-aloud':
      return '朗读下面的英文'
    case 'repeat':
      return '先听音频，再跟读'
    case 'spoken-response':
      return '用英语回答'
  }
}

function questionHeader(
  state: AssessmentRuntimeState,
): TrainingHeaderViewModel {
  const domain = state.progress.domain
  const value =
    state.progress.totalMaximum === 0
      ? 0
      : Math.round(
          (state.progress.totalAttempted /
            state.progress.totalMaximum) *
            100,
        )
  return {
    eyebrow: domain?.toLocaleUpperCase('en-US') ?? 'ASSESSMENT',
    title: '水平测试',
    progress: {
      label: domain
        ? `${domainLabels[domain]}阶段 · 已完成 ${state.progress.domainAttempted} 题`
        : '测试完成',
      value,
    },
  }
}

function fallbackViewModel(
  fallback: AssessmentSubmissionSummary['fallback'],
): AssessmentFallbackNoticeViewModel | null {
  switch (fallback) {
    case 'recording-playback':
      return {
        kind: fallback,
        label: '本题未用于估算',
        description: '语音识别没有得到可靠结果，你仍可播放录音自查。',
      }
    case 'retry-audio':
      return {
        kind: fallback,
        label: '音频没有正常播放',
        description: '本题未按答错处理；请检查设备后继续。',
      }
    case 'device-check':
      return {
        kind: fallback,
        label: '需要检查设备权限',
        description: '本题没有可靠证据，因此不会猜测你的水平。',
      }
    case null:
      return null
  }
}

function submissionFeedback(
  submission: AssessmentSubmissionSummary,
): FeedbackViewModel {
  if (submission.status === 'recorded') {
    return {
      tone: 'info',
      title: '本题已记录',
      description: '测试期间不显示对错，避免影响后续题目的估算。',
    }
  }
  if (submission.status === 'skipped') {
    return {
      tone: 'info',
      title: '本题已跳过',
      description: '系统会按水平测试规则处理这次跳过。',
    }
  }
  return {
    tone: 'device',
    title: '本题无法可靠评分',
    description: '设备或识别失败不会被算作英语能力错误。',
  }
}

function submissionViewModel(
  submission: AssessmentSubmissionSummary | null,
): AssessmentLastSubmissionViewModel | undefined {
  if (!submission) {
    return undefined
  }
  return {
    itemId: submission.itemId,
    status: submission.status,
    failureReason: submission.failureReason,
    fallback: fallbackViewModel(submission.fallback),
    feedback: submissionFeedback(submission),
  }
}

function audioViewModel(
  status: AudioPlayerViewModel['status'],
  playCount: number,
  maxPlays: number,
): AudioPlayerViewModel {
  return {
    status,
    elapsedLabel: '—',
    durationLabel: '系统语音',
    progressValue: status === 'ended' ? 100 : 0,
    rateLabel: '标准速度',
    playCountLabel: `${playCount}/${maxPlays} 次`,
    statusLabel:
      status === 'playing'
        ? '正在播放'
        : status === 'error' || status === 'unavailable'
          ? '音频不可用'
          : playCount >= maxPlays
            ? '已达到播放次数'
            : '可以播放',
  }
}

export interface AssessmentQuestionPresentation {
  readonly audioStatus: AudioPlayerViewModel['status']
  readonly audioPlayCount: number
  readonly recorder: RecorderViewModel
  readonly speechEvidenceReady: boolean
  readonly busy: boolean
}

export type AssessmentQuestionViewModel =
  | {
      readonly kind: 'choice'
      readonly viewModel: AssessmentChoiceViewModel
    }
  | {
      readonly kind: 'speech'
      readonly viewModel: AssessmentSpeechViewModel
    }

export function toAssessmentQuestionViewModel(
  state: AssessmentRuntimeState,
  item: PublicAssessmentItem,
  presentation: AssessmentQuestionPresentation,
): AssessmentQuestionViewModel {
  const isFeedback = state.lifecycle === 'feedback'
  const primaryAction = isFeedback
    ? {
        kind: 'continue' as const,
        label: '继续下一题',
        disabled: !state.actions.canContinue || presentation.busy,
        busy: presentation.busy,
        busyLabel: '正在继续',
      }
    : {
        kind: 'submit' as const,
        label: item.kind === 'speech' ? '提交录音' : '提交答案',
        disabled:
          presentation.busy ||
          (item.kind === 'choice'
            ? !state.actions.canSubmitChoice
            : !state.actions.canSubmitSpeech ||
              !presentation.speechEvidenceReady),
        busy: presentation.busy,
        busyLabel: '正在提交',
        disabledReason:
          item.kind === 'speech' &&
          !presentation.speechEvidenceReady
            ? '请先完成录音'
            : undefined,
      }
  const common = {
    sessionId: state.sessionId,
    itemId: item.id,
    header: questionHeader(state),
    instruction: questionInstruction(item),
    prompt: item.prompt,
    stimulus: item.stimulus.text ?? undefined,
    submission: submissionViewModel(state.lastSubmission),
    primaryAction,
    skipAction: isFeedback
      ? undefined
      : {
          label: '跳过本题',
          disabled: !state.actions.canSkip || presentation.busy,
        },
    pauseAction: {
      label: '暂停测试',
      disabled: !state.actions.canPause || presentation.busy,
    },
  }

  if (item.kind === 'choice') {
    const audioText = item.stimulus.audioText
    const maxPlays = item.stimulus.maxPlays
    return {
      kind: 'choice',
      viewModel: {
        ...common,
        choices: item.options.map((option) => ({
          id: option.id,
          label: option.text,
          state: isFeedback
            ? 'disabled' as const
            : state.selectedOptionId === option.id
              ? 'selected' as const
              : 'default' as const,
        })),
        audio: audioText
          ? audioViewModel(
              presentation.audioStatus,
              presentation.audioPlayCount,
              maxPlays,
            )
          : undefined,
      },
    }
  }

  return {
    kind: 'speech',
    viewModel: {
      ...common,
      audio: item.stimulus.audioText
        ? audioViewModel(
            presentation.audioStatus,
            presentation.audioPlayCount,
            item.stimulus.maxPlays,
          )
        : undefined,
      recorder: presentation.recorder,
    },
  }
}

export function toAssessmentPausedViewModel(
  state: AssessmentRuntimeState,
  busy: boolean,
): AssessmentPausedViewModel {
  return {
    sessionId: state.sessionId,
    header: questionHeader(state),
    title: '水平测试已暂停',
    description:
      '关闭应用的时间不会计入 20 分钟限制。准备好后可从当前题继续。',
    statusLabel: `已完成 ${state.progress.totalAttempted} 题`,
    resumeAction: {
      label: '继续测试',
      disabled: !state.actions.canResume || busy,
      busy,
      busyLabel: '正在恢复',
    },
    stopAction: {
      label: '结束并保存当前结果',
      disabled: !state.actions.canStop || busy,
    },
  }
}

function abilityViewModel(ability: AbilityEstimate) {
  const levelLabel =
    ability.internalLevel === null
      ? '暂不估算'
      : describeInternalLevel(ability.internalLevel)
  const rangeLabel =
    ability.internalRange === null
      ? undefined
      : `内部等级 ${ability.internalRange.lower}–${ability.internalRange.upper}`
  const confidenceLabels = {
    high: '置信度高',
    moderate: '置信度中等',
    low: '置信度较低',
    insufficient: '证据不足',
  } as const
  return {
    domain: ability.domain,
    label: domainLabels[ability.domain],
    status: ability.status,
    levelLabel,
    rangeLabel,
    confidenceLabel: confidenceLabels[ability.confidenceBand],
    message:
      ability.status === 'unavailable'
        ? INSUFFICIENT_EVIDENCE_MESSAGE
        : ability.message,
    warnings: ability.warnings,
  }
}

export function toAssessmentResultsViewModel(
  profile: AbilityProfile,
): AssessmentResultsViewModel {
  return {
    outcomeLabel:
      profile.outcome === 'completed' ? '起点估算完成' : '已保存部分结果',
    completedAtLabel: `完成时间：${new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(profile.completedAt))}`,
    abilities: [
      abilityViewModel(profile.abilities.vocabulary),
      abilityViewModel(profile.abilities.listening),
      abilityViewModel(profile.abilities.speaking),
    ],
    disclaimer: profile.disclaimer,
  }
}
