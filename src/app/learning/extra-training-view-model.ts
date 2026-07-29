import type {
  ExtraListeningTrainingSnapshot,
} from '../../features/listening/index.ts'
import type {
  ExtraSpeakingTrainingSnapshot,
} from '../../features/speaking/index.ts'
import type {
  ExtraVocabularyTrainingSnapshot,
} from '../../features/vocabulary/index.ts'
import type {
  ExtraTrainingSession,
  LearningEngineState,
  PlanProgress,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import type {
  ChoiceViewModel,
  ExtraTrainingActiveSessionViewModel,
  ExtraTrainingCompletionViewModel,
  ExtraTrainingModuleViewModel,
  ExtraTrainingPickerViewModel,
  FeedbackViewModel,
  ListeningScreenViewModel,
  SpeakingScreenViewModel,
  VocabularyScreenViewModel,
} from '../../ui/index.ts'
import {
  trainingBlockDurationLabel,
} from '../../config/training-test-mode.ts'

const modulePresentation: Record<
  TrainingModuleId,
  {
    readonly title: string
    readonly description: string
  }
> = {
  vocabulary: {
    title: '词汇额外训练',
    description: '继续巩固错词、到期复习和当天词汇变式。',
  },
  listening: {
    title: '听力额外训练',
    description: '继续练习已发布的辨音、听辨和听写内容。',
  },
  speaking: {
    title: '口语额外训练',
    description: '继续练习已发布的固定表达和场景回答。',
  },
}

const moduleIds = [
  'vocabulary',
  'listening',
  'speaking',
] as const satisfies readonly TrainingModuleId[]

export function isDailyPlanCompleted3Of3(
  progress: PlanProgress,
  localDate: string,
): boolean {
  return (
    progress.plan.localDate === localDate &&
    progress.status === 'completed' &&
    progress.tasks.length === 3 &&
    progress.tasks.every(
      (task) =>
        task.status === 'completed' ||
        task.status === 'skipped',
    )
  )
}

function action(
  label: string,
  busy: boolean,
): {
  readonly label: string
  readonly disabled: boolean
  readonly loading: boolean
  readonly disabledReason?: string
} {
  return {
    label,
    disabled: busy,
    loading: busy,
    disabledReason: busy ? '正在保存当前额外训练状态。' : undefined,
  }
}

function latestSession(
  engineState: LearningEngineState,
  moduleId: TrainingModuleId,
  localDate: string,
): ExtraTrainingSession | undefined {
  return Object.values(
    engineState.extraTraining?.sessions ?? {},
  )
    .filter(
      (session) =>
        session.targetModuleId === moduleId &&
        (session.localDate === localDate ||
          session.status === 'expired'),
    )
    .sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    )[0]
}

function toModuleViewModel(
  moduleId: TrainingModuleId,
  session: ExtraTrainingSession | undefined,
  busy: boolean,
): ExtraTrainingModuleViewModel {
  const durationLabel = trainingBlockDurationLabel()
  const base = {
    moduleId,
    ...modulePresentation[moduleId],
    targetEffectiveSeconds: 900,
  }
  if (!session) {
    return {
      ...base,
      status: 'available',
      startAction: action(`开始 ${durationLabel}`, busy),
    }
  }
  if (session.status === 'expired') {
    return {
      ...base,
      targetEffectiveSeconds: session.targetEffectiveSeconds,
      status: 'expired',
      sessionId: session.sessionId,
      completedItemCount: session.completedItemCount,
      startAction: action('开始今天的新一轮', busy),
    }
  }
  const progress = {
    ...base,
    targetEffectiveSeconds: session.targetEffectiveSeconds,
    sessionId: session.sessionId,
    remainingEffectiveSeconds: session.remainingEffectiveSeconds,
    completedItemCount: session.completedItemCount,
  }
  if (session.status === 'completed') {
    return {
      ...progress,
      status: 'completed',
      startAction: action(`再练 ${durationLabel}`, busy),
    }
  }
  if (session.status === 'paused') {
    return {
      ...progress,
      status: 'paused',
      resumeAction: action('继续上次训练', busy),
    }
  }
  if (
    session.status === 'running' ||
    session.status === 'finish-current-item'
  ) {
    return {
      ...progress,
      status: 'running',
      resumeAction: action('进入当前训练', busy),
    }
  }
  if (session.endReason === 'content-exhausted') {
    return {
      ...progress,
      status: 'content-exhausted',
      failureDescription:
        '当前没有可继续提供的合格题目；剩余时间和排除记录已保留。',
      retryAction: action('重新获取题目', busy),
    }
  }
  const deviceFailure = session.endReason === 'device-failure'
  return {
    ...progress,
    status: 'failed',
    failureReason: deviceFailure
      ? 'device-failure'
      : 'provider-failure',
    failureDescription: deviceFailure
      ? '设备能力暂时不可用；当前会话与进度已保存。'
      : '训练内容暂时无法加载；当前会话与进度已保存。',
    retryAction: action('重试当前训练', busy),
  }
}

export function toExtraTrainingPickerViewModel(
  engineState: LearningEngineState,
  localDate: string,
  busy = false,
): ExtraTrainingPickerViewModel {
  return {
    modules: moduleIds.map((moduleId) =>
      toModuleViewModel(
        moduleId,
        latestSession(engineState, moduleId, localDate),
        busy,
      ),
    ),
    returnAction: {
      ...action('返回今日完成', busy),
      label: '返回今日完成',
    },
  }
}

function contentExhaustedReason(
  session: ExtraTrainingSession,
): 'provider-failure' | 'no-eligible-content' {
  return session.endReason === 'provider-failure'
    ? 'provider-failure'
    : 'no-eligible-content'
}

export function toExtraTrainingActiveViewModel<
  TModuleId extends TrainingModuleId,
>(
  session: ExtraTrainingSession,
  moduleId: TModuleId,
  busy = false,
): ExtraTrainingActiveSessionViewModel<TModuleId> {
  if (session.targetModuleId !== moduleId) {
    throw new TypeError(
      'Extra-training session does not match its requested module.',
    )
  }
  const base = {
    targetEffectiveSeconds: session.targetEffectiveSeconds,
    remainingEffectiveSeconds: session.remainingEffectiveSeconds,
    completedItemCount: session.completedItemCount,
  }
  const budget =
    session.status === 'failed' &&
    session.endReason === 'content-exhausted'
      ? {
          ...base,
          status: 'content-exhausted' as const,
          contentExhausted: {
            reason: contentExhaustedReason(session),
            description:
              '当前没有可继续提供的合格题目；已完成内容和剩余时间都已保留。',
          },
          retryAction: action('重新获取题目', busy),
        }
      : session.status === 'finish-current-item'
        ? {
            ...base,
            status: 'finish-current-item' as const,
          }
        : {
            ...base,
            status: 'running' as const,
          }
  return {
    sessionId: session.sessionId,
    moduleId,
    budget,
    exitAction: {
      ...action('退出并保存', busy),
      label: '退出并保存',
    },
  }
}

export function toExtraTrainingCompletionViewModel(
  session: ExtraTrainingSession,
  busy = false,
): ExtraTrainingCompletionViewModel {
  if (
    session.status !== 'completed' ||
    session.endReason !== 'budget-reached'
  ) {
    throw new TypeError(
      'Only a budget-completed extra-training session has a completion view.',
    )
  }
  const chooseAgainLabel = `再练 ${trainingBlockDurationLabel()}`
  return {
    sessionId: session.sessionId,
    moduleId: session.targetModuleId,
    title: `${modulePresentation[session.targetModuleId].title}已完成`,
    description:
      '本轮额外练习已保存，不会改变今日计划 3/3 完成状态。',
    completedItemCount: session.completedItemCount,
    actualDuration: {
      state: 'reliable',
      effectiveSeconds:
        session.targetEffectiveSeconds -
        session.remainingEffectiveSeconds,
      source: 'timing-segments',
    },
    chooseAgainAction: {
      ...action(chooseAgainLabel, busy),
      label: chooseAgainLabel,
    },
    returnAction: {
      ...action('返回今日完成', busy),
      label: '返回今日完成',
    },
  }
}

function progress(
  session: ExtraTrainingSession,
): {
  readonly label: string
  readonly value: number
} {
  const elapsed =
    session.targetEffectiveSeconds -
    session.remainingEffectiveSeconds
  return {
    label: `累计完成 ${session.completedItemCount} 题`,
    value: Math.round(
      (elapsed / Math.max(1, session.targetEffectiveSeconds)) * 100,
    ),
  }
}

function choiceState(
  phase: 'answering' | 'feedback' | 'paused' | 'completed' | 'error',
  selectedOptionId: string | null,
  correctOptionId: string,
  optionId: string,
): ChoiceViewModel['state'] {
  if (phase === 'answering') {
    return selectedOptionId === optionId ? 'selected' : 'default'
  }
  if (phase !== 'feedback') {
    return 'disabled'
  }
  if (optionId === correctOptionId) {
    return 'correct'
  }
  if (optionId === selectedOptionId) {
    return 'incorrect'
  }
  return 'disabled'
}

export function toExtraVocabularyScreenViewModel(
  snapshot: ExtraVocabularyTrainingSnapshot,
  busy = false,
): VocabularyScreenViewModel {
  const question = snapshot.question
  if (!question) {
    throw new TypeError('Extra vocabulary question is not ready.')
  }
  const answered = snapshot.phase === 'feedback'
  const correct =
    answered &&
    snapshot.selectedOptionId === question.correctOptionId
  return {
    header: {
      eyebrow: '额外词汇训练',
      title: '词汇训练',
      progress: progress(snapshot.session),
    },
    instruction: question.instructionZh,
    term: question.prompt,
    partOfSpeech: question.partOfSpeech ?? undefined,
    choices: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      state: busy
        ? 'disabled'
        : choiceState(
            snapshot.phase,
            snapshot.selectedOptionId,
            question.correctOptionId,
            option.id,
          ),
    })),
    feedback: answered
      ? {
          tone: correct ? 'success' : 'correction',
          title: correct ? '回答正确' : '再看一次正确答案',
          description: correct
            ? '本题结果会保存为额外训练证据。'
            : '本题错误会进入后续复习证据。',
        }
      : undefined,
    exampleEn: answered ? question.exampleEn ?? undefined : undefined,
    explanationZh: answered
      ? question.explanationZh ?? undefined
      : undefined,
    action:
      snapshot.phase === 'feedback'
        ? {
            label:
              snapshot.session.status === 'finish-current-item'
                ? '完成本题并结束'
                : '下一题',
            disabled: busy,
            loading: busy,
          }
        : {
            label: '提交答案',
            disabled:
              busy || snapshot.selectedOptionId === null,
            loading: busy,
          },
  }
}

function listeningInstruction(
  snapshot: ExtraListeningTrainingSnapshot,
): string {
  switch (snapshot.question?.type) {
    case 'word-discrimination':
      return '单词辨音'
    case 'short-sentence-choice':
      return '短句听辨'
    case 'keyword-dictation':
      return '关键词听写'
    case 'scene-comprehension':
      return '场景理解'
    default:
      return '核心信息'
  }
}

function listeningFeedback(
  snapshot: ExtraListeningTrainingSnapshot,
): FeedbackViewModel | undefined {
  if (!snapshot.answer) {
    return snapshot.playback?.errorMessage
      ? {
          tone: 'device',
          title: '这段音频暂时无法播放',
          description: snapshot.playback.errorMessage,
        }
      : undefined
  }
  return {
    tone: snapshot.answer.correct ? 'success' : 'correction',
    title: snapshot.answer.correct ? '回答正确' : '答案需要再听一次',
    description: snapshot.question?.rationaleZh,
  }
}

export function toExtraListeningScreenViewModel(
  snapshot: ExtraListeningTrainingSnapshot,
  busy = false,
): ListeningScreenViewModel {
  const question = snapshot.question
  const playback = snapshot.playback
  if (!question || !playback) {
    throw new TypeError('Extra listening question is not ready.')
  }
  const controlsDisabled =
    busy ||
    snapshot.phase === 'paused' ||
    playback.status === 'unavailable' ||
    playback.status === 'error'
  const playCount = Object.values(playback.playCounts).reduce(
    (total, count) => total + count,
    0,
  )
  return {
    header: {
      eyebrow: '额外听力训练',
      title: '听力训练',
      progress: progress(snapshot.session),
    },
    instruction: listeningInstruction(snapshot),
    player: {
      status: playback.status,
      elapsedLabel: playback.status === 'ended' ? '完成' : '--',
      durationLabel: '--',
      progressValue: playback.status === 'ended' ? 100 : 0,
      rateLabel: `${playback.rate}×`,
      playCountLabel: `已播放 ${playCount} 次`,
      statusLabel:
        playback.status === 'playing'
          ? '正在播放'
          : playback.status === 'paused'
            ? '已暂停'
            : playback.status === 'ended'
              ? '播放完毕'
              : playback.status === 'error'
                ? '播放失败'
                : '准备播放',
    },
    playbackControls: {
      rate: {
        label: '播放速度',
        currentValue: playback.rate,
        options: question.playbackPolicy.allowedRates.map((rate) => ({
          value: rate,
          label: `${rate}×`,
        })),
        disabled: controlsDisabled,
      },
      segment: {
        label: '训练片段',
        currentId: playback.currentSegmentId,
        options: question.segments.map((segment) => ({
          id: segment.id,
          label: segment.label,
          supportingText: segment.speaker ?? undefined,
          disabled:
            !question.playbackPolicy.allowSegmentSelection &&
            segment.id !== question.primarySegmentId,
        })),
        disabled:
          controlsDisabled ||
          !question.playbackPolicy.allowSegmentSelection ||
          question.segments.length < 2,
      },
      repeat: {
        label: '重复方式',
        currentMode: playback.repeatMode,
        options: [
          { value: 'none', label: '不重复' },
          {
            value: 'segment',
            label: '重复当前片段',
            disabled: !question.playbackPolicy.allowRepeat,
          },
          {
            value: 'all',
            label: '循环全部片段',
            disabled:
              !question.playbackPolicy.allowRepeat ||
              question.segments.length < 2,
          },
        ],
        disabled: controlsDisabled,
      },
    },
    question:
      question.type === 'keyword-dictation'
        ? {
            kind: 'keyword-dictation',
            prompt: question.promptZh,
            textInput: {
              label: '听写答案',
              value: snapshot.dictationInput,
              placeholder: '输入听到的关键词',
              disabled:
                busy || snapshot.phase !== 'answering',
              state:
                snapshot.phase === 'feedback'
                  ? 'submitted'
                  : snapshot.dictationInput.trim()
                    ? 'ready'
                    : 'empty',
              description: `目标关键词 ${question.targetKeywords.length} 个`,
              statusLabel:
                snapshot.phase === 'feedback'
                  ? '已提交'
                  : undefined,
            },
          }
        : {
            kind: 'single-choice',
            prompt: question.promptZh,
            choices: question.options.map((option) => ({
              id: option.id,
              label: option.label,
              state: busy
                ? 'disabled'
                : choiceState(
                    snapshot.phase,
                    snapshot.selectedOptionId,
                    question.correctOptionId,
                    option.id,
                  ),
            })),
          },
    feedback: listeningFeedback(snapshot),
    transcript:
      snapshot.phase === 'feedback'
        ? snapshot.unit?.transcript.map((line) => ({
            id: line.id,
            speaker: line.speaker ?? undefined,
            text: line.text,
            translationZh: line.translationZh,
          }))
        : undefined,
    rationaleZh:
      snapshot.phase === 'feedback'
        ? question.rationaleZh
        : undefined,
    action:
      snapshot.phase === 'feedback'
        ? {
            label:
              snapshot.session.status === 'finish-current-item'
                ? '完成本题并结束'
                : '下一题',
            disabled: busy,
            loading: busy,
          }
        : {
            label: '提交答案',
            disabled:
              busy ||
              (question.type === 'keyword-dictation'
                ? snapshot.dictationInput.trim().length === 0
                : snapshot.selectedOptionId === null),
            loading: busy,
          },
  }
}

function speakingFeedback(
  snapshot: ExtraSpeakingTrainingSnapshot,
): FeedbackViewModel | undefined {
  const answer = snapshot.answer
  if (!answer) {
    return undefined
  }
  if (answer.match) {
    return {
      tone:
        answer.match.level === 'match'
          ? 'success'
          : answer.match.level === 'close'
            ? 'info'
            : 'correction',
      title:
        answer.match.level === 'match'
          ? '识别文本与目标表达一致'
          : '已完成有限内容匹配',
      description:
        `识别文本：“${answer.match.transcript}”。` +
        '这里只比较课程目标内容，不是发音评分。',
    }
  }
  return {
    tone: 'device',
    title: answer.recorded
      ? '文本识别不可用，录音仍可回放'
      : '没有可评分的口语证据',
    description:
      '本题会保存为不可评分练习，不会伪造分数或记为答错。',
  }
}

export function toExtraSpeakingScreenViewModel(
  snapshot: ExtraSpeakingTrainingSnapshot,
  busy = false,
): SpeakingScreenViewModel {
  const prompt = snapshot.prompt
  if (!prompt) {
    throw new TypeError('Extra speaking prompt is not ready.')
  }
  const feedback = snapshot.phase === 'feedback'
  const recorderStatus = snapshot.phase === 'paused'
    ? 'processing'
    : feedback
      ? snapshot.answer?.recorded
        ? 'review'
        : 'unavailable'
      : snapshot.recordingAvailable
        ? 'recording'
        : 'ready'
  return {
    header: {
      eyebrow: '额外口语训练',
      title: '口语训练',
      progress: progress(snapshot.session),
    },
    instruction:
      snapshot.unit?.instructionsZh ?? '按提示完成口语练习。',
    prompt: 'Respond in English',
    cueZh: prompt.cueZh,
    partnerLine: prompt.partnerLine,
    modelAnswer: prompt.modelAnswer,
    recorder: {
      status: recorderStatus,
      statusLabel:
        snapshot.phase === 'paused'
          ? '训练已暂停'
          : recorderStatus === 'recording'
            ? '正在录音'
            : recorderStatus === 'review'
              ? '录音完成'
              : recorderStatus === 'unavailable'
                ? '录音不可用'
                : '准备录音',
      playbackAvailable: Boolean(snapshot.answer?.recorded),
      description:
        snapshot.answer?.fallbackReason
          ? '识别不可用时已保留录音回放降级。'
          : undefined,
    },
    feedback: speakingFeedback(snapshot),
    action: feedback
      ? {
          label:
            snapshot.session.status === 'finish-current-item'
              ? '完成本题并结束'
              : '下一题',
          disabled: busy,
          loading: busy,
        }
      : {
          label: '完成录音后继续',
          disabled: true,
          loading: busy,
        },
    secondaryActionLabel:
      snapshot.phase === 'practicing' &&
      !snapshot.recordingAvailable
        ? '无法录音，继续本题'
        : undefined,
  }
}
