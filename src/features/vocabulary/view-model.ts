import type {
  ChoiceViewModel,
  VocabularyScreenViewModel,
} from '../../ui/index.ts'
import { VocabularyError } from './errors.ts'
import {
  getCurrentVocabularyQuestion,
  getVocabularyAnswerFeedback,
} from './session.ts'
import type {
  VocabularyQuestion,
  VocabularySession,
} from './types.ts'

function choiceState(
  session: VocabularySession,
  question: VocabularyQuestion,
  optionId: string,
): ChoiceViewModel['state'] {
  if (session.phase === 'paused') {
    return 'disabled'
  }
  if (session.phase === 'answering') {
    return session.selectedOptionId === optionId ? 'selected' : 'default'
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

function modeLabel(session: VocabularySession): string {
  if (session.task.mode === 'review') {
    return '词汇复习'
  }
  if (session.task.mode === 'retry') {
    return '词汇重试'
  }
  if (session.task.mode === 'calibration') {
    return '词汇校准'
  }
  return '词汇学习'
}

export function toVocabularyScreenViewModel(
  session: VocabularySession,
  operationPending = false,
): VocabularyScreenViewModel {
  const question = getCurrentVocabularyQuestion(session)
  if (
    !question ||
    (session.phase !== 'answering' &&
      session.phase !== 'feedback' &&
      session.phase !== 'paused')
  ) {
    throw new VocabularyError(
      'session-transition-invalid',
      'Only an active vocabulary session has a training ViewModel.',
    )
  }
  const feedback = getVocabularyAnswerFeedback(session)
  const isLastQuestion =
    session.questionIndex + 1 === session.questions.length
  const action =
    session.phase === 'paused'
      ? { label: '继续训练' }
      : session.phase === 'feedback'
        ? { label: isLastQuestion ? '完成训练' : '下一题' }
        : {
            label: '提交答案',
            disabled: session.selectedOptionId === null,
          }

  const viewModel: VocabularyScreenViewModel = {
    header: {
      eyebrow: modeLabel(session),
      title: '词汇训练',
      progress: {
        label: `已完成 ${session.answers.length} / ${session.questions.length}`,
        value: Math.round(
          (session.answers.length / session.questions.length) * 100,
        ),
      },
    },
    instruction: question.instructionZh,
    term: question.prompt,
    partOfSpeech: question.partOfSpeech ?? undefined,
    choices: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      state: choiceState(session, question, option.id),
    })),
    feedback: feedback
      ? {
          tone: feedback.correct ? 'success' : 'correction',
          title: feedback.title,
          description: feedback.description,
        }
      : undefined,
    exampleEn: feedback?.exampleEn ?? undefined,
    explanationZh: feedback?.explanationZh ?? undefined,
    action,
  }

  if (!operationPending) {
    return viewModel
  }

  return {
    ...viewModel,
    choices: viewModel.choices.map((choice) => ({
      ...choice,
      state: 'disabled',
    })),
    action: {
      ...viewModel.action,
      disabled: true,
      loading: true,
    },
  }
}
