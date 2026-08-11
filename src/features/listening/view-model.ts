import type {
  ChoiceViewModel,
  ListeningScreenViewModel,
} from '../../ui/index.ts'
import { ListeningError } from './errors.ts'
import {
  canSubmitListeningAnswer,
  getCurrentListeningQuestion,
  getListeningAnswerFeedback,
  hasCompletedListeningPlayback,
} from './session.ts'
import type {
  ListeningChoiceQuestion,
  ListeningQuestion,
  ListeningSession,
} from './types.ts'

function choiceState(
  session: ListeningSession,
  question: ListeningChoiceQuestion,
  optionId: string,
): ChoiceViewModel['state'] {
  if (session.phase === 'paused') {
    return 'disabled'
  }
  if (session.phase === 'answering') {
    return session.selectedOptionId === optionId
      ? 'selected'
      : 'default'
  }
  if (session.phase !== 'feedback') {
    return 'disabled'
  }
  if (optionId === question.correctOptionId) {
    return 'correct'
  }
  if (optionId === session.selectedOptionId) {
    return 'incorrect'
  }
  return 'disabled'
}

function modeLabel(session: ListeningSession): string {
  if (session.task.mode === 'review') {
    return '听力复习'
  }
  if (session.task.mode === 'retry') {
    return '听力重试'
  }
  if (session.task.mode === 'calibration') {
    return '听力校准'
  }
  return '听力学习'
}

function instruction(question: ListeningQuestion): string {
  if (question.type === 'word-discrimination') {
    return '单词辨音'
  }
  if (question.type === 'short-sentence-choice') {
    return '短句听辨'
  }
  if (question.type === 'keyword-dictation') {
    return '关键词听写'
  }
  if (question.type === 'scene-comprehension') {
    return '场景理解'
  }
  return '核心信息'
}

function playbackStatusLabel(session: ListeningSession): string {
  switch (session.playback.status) {
    case 'playing':
      return '正在播放'
    case 'paused':
      return '已暂停'
    case 'ended':
      return '播放完毕'
    case 'unavailable':
      return '语音不可用'
    case 'error':
      return '播放失败'
    default:
      return '准备播放'
  }
}

export function toListeningScreenViewModel(
  session: ListeningSession,
): ListeningScreenViewModel {
  const question = getCurrentListeningQuestion(session)
  if (
    !question ||
    (session.phase !== 'answering' &&
      session.phase !== 'feedback' &&
      session.phase !== 'paused')
  ) {
    throw new ListeningError(
      'session-transition-invalid',
      'Only an active listening session has a training ViewModel.',
    )
  }
  const feedback = getListeningAnswerFeedback(session)
  const currentAnswer = session.answers.find(
    (answer) => answer.questionId === question.id,
  )
  const controlsDisabled =
    session.phase === 'paused' ||
    session.playback.status === 'unavailable' ||
    session.playback.status === 'error'
  const totalPlayCount = Object.values(
    session.playback.playCounts,
  ).reduce((sum, count) => sum + count, 0)
  const playbackCompleted = hasCompletedListeningPlayback(
    session.playback,
    question,
  )
  const isLastQuestion =
    session.questionIndex + 1 === session.questions.length
  const action =
    session.phase === 'paused'
      ? { label: '继续训练' }
      : session.phase === 'feedback'
        ? { label: isLastQuestion ? '完成训练' : '下一题' }
        : {
            label: '提交答案',
            disabled: !canSubmitListeningAnswer(session),
          }

  return {
    header: {
      eyebrow: modeLabel(session),
      title: '听力训练',
      progress: {
        label: `已完成 ${session.answers.length} / ${session.questions.length}`,
        value: Math.round(
          (session.answers.length / session.questions.length) * 100,
        ),
      },
    },
    instruction: instruction(question),
    player: {
      status: session.playback.status,
      elapsedLabel: session.playback.status === 'ended' ? '完成' : '--',
      durationLabel: '--',
      progressValue: session.playback.status === 'ended' ? 100 : 0,
      rateLabel: `${session.playback.rate}×`,
      playCountLabel: `已播放 ${totalPlayCount} 次`,
      statusLabel: playbackStatusLabel(session),
    },
    playbackControls: {
      rate: {
        label: '播放速度',
        currentValue: session.playback.rate,
        options: question.playbackPolicy.allowedRates.map((rate) => ({
          value: rate,
          label: `${rate}×`,
        })),
        disabled: controlsDisabled,
      },
      segment: {
        label: '训练片段',
        currentId: session.playback.currentSegmentId,
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
        currentMode: session.playback.repeatMode,
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
            requirements: {
              targetLabel: question.promptZh,
              countLabel: `需要填写 ${question.targetKeywords.length} 项关键信息。`,
              orderLabel:
                question.targetKeywords.length === 1
                  ? '只有 1 项，不涉及先后顺序。'
                  : '必须按照音频中出现的顺序填写。',
              formatLabel:
                '输入一条英文短语，用空格连接；连接词可以省略，大小写和句末标点不影响判定。',
            },
            answerGuidance: question.answerGuidance,
            textInput: {
              label: '听写答案',
              value: session.dictationInput,
              placeholder: '输入听到的关键词',
              disabled:
                session.phase !== 'answering' || controlsDisabled,
              state:
                session.phase === 'feedback'
                  ? 'submitted'
                  : session.dictationInput.trim().length > 0
                    ? 'ready'
                    : 'empty',
              description: '提交后会显示你的输入、参考答案和目标关键词。',
              statusLabel:
                session.phase === 'feedback' ? '已提交' : undefined,
            },
            review:
              session.phase === 'feedback' && currentAnswer
                ? {
                    response: currentAnswer.response,
                    standardAnswer: question.standardAnswer,
                    targetKeywords: question.targetKeywords,
                    resultLabel: currentAnswer.correct
                      ? '回答正确'
                      : '回答不正确，请逐项对照',
                  }
                : undefined,
          }
        : {
            kind: 'single-choice',
            prompt: question.promptZh,
            available: playbackCompleted,
            waitingLabel: playbackCompleted
              ? undefined
              : '请先完整播放一次，播放结束后显示英文选项。',
            choices: question.options.map((option) => ({
              id: option.id,
              label: option.label,
              supportingText:
                session.phase === 'feedback'
                  ? option.translationZh
                  : undefined,
              state: choiceState(session, question, option.id),
            })),
          },
    feedback: feedback
      ? {
          tone: feedback.correct ? 'success' : 'correction',
          title: feedback.title,
          description: feedback.description,
        }
      : session.playback.errorMessage
        ? {
            tone: 'device',
            title: '这段音频暂时无法播放',
            description: session.playback.errorMessage,
          }
        : undefined,
    transcript:
      session.phase === 'feedback'
        ? session.transcript.map((line) => ({
            id: line.id,
            speaker: line.speaker ?? undefined,
            text: line.text,
            translationZh: line.translationZh,
          }))
        : undefined,
    rationaleZh: feedback?.rationaleZh,
    action,
  }
}
