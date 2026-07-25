import type { LearningTask } from '../../learning-engine/index.ts'
import type {
  ListeningKeywordDictationQuestion,
  ListeningQuestion,
  ListeningTrainingUnit,
} from './types.ts'

export function createListeningTask(
  overrides: Partial<LearningTask> = {},
): LearningTask {
  return {
    schemaVersion: 1,
    taskId: 'task-listening-1',
    planId: 'plan-1',
    sequence: 1,
    learningUnitId: 'st4w-w1d1-listening',
    contentRef:
      'lesson://survival-travel-american-4w/1.0.0/w1d1/listening',
    domain: 'listening',
    targetModuleId: 'listening',
    mode: 'learn',
    origin: 'new',
    difficultyLevel: 2,
    estimatedSeconds: 900,
    required: true,
    dueAt: null,
    skipLimit: 2,
    tags: ['scene:introductions'],
    ...overrides,
  }
}

const sharedSegments = [
  {
    id: 'seg-word',
    locale: 'en-US',
    text: 'Maya',
    label: '片段 1',
    speaker: null,
  },
  {
    id: 'seg-sentence',
    locale: 'en-US',
    text: "I'm visiting Boston this week.",
    label: '片段 2',
    speaker: 'Leo',
  },
] as const

export const choiceQuestion: ListeningQuestion = {
  id: 'question-choice',
  type: 'word-discrimination',
  promptZh: '你听到哪个名字？',
  primarySegmentId: 'seg-word',
  segments: sharedSegments,
  playbackPolicy: {
    allowSegmentSelection: false,
    allowRepeat: true,
    allowedRates: [0.75, 1],
  },
  options: [
    { id: 'a', label: 'Maya' },
    { id: 'b', label: 'Mia' },
    { id: 'c', label: 'Myra' },
  ],
  correctOptionId: 'a',
  rationaleZh: '音频读的是 Maya。',
  errorTag: 'sound-discrimination',
}

export const dictationQuestion: ListeningKeywordDictationQuestion = {
  id: 'question-dictation',
  type: 'keyword-dictation',
  promptZh: '写出城市名。',
  primarySegmentId: 'seg-sentence',
  segments: sharedSegments,
  playbackPolicy: {
    allowSegmentSelection: true,
    allowRepeat: true,
    allowedRates: [0.75, 1, 1.25],
  },
  targetKeywords: ['Boston'],
  standardAnswer: 'Boston',
  acceptedAnswers: ['Boston'],
  normalizationHints: {
    trim: true,
    caseFoldLocale: 'en-US',
    collapseWhitespace: true,
    normalizeApostrophes: true,
    stripTerminalPunctuation: true,
  },
  rationaleZh: '城市是 Boston。',
  errorTag: 'detail-missed',
}

export function createListeningUnit(
  questions: readonly ListeningQuestion[] = [
    choiceQuestion,
    dictationQuestion,
  ],
): ListeningTrainingUnit {
  return {
    learningUnitId: 'st4w-w1d1-listening',
    contentRef:
      'lesson://survival-travel-american-4w/1.0.0/w1d1/listening',
    difficultyLevel: 2,
    estimatedSeconds: 900,
    tags: ['scene:introductions'],
    activityType: 'listening-dialogue',
    titleZh: '酒店大堂里的问候',
    transcript: [
      {
        id: 'st4w-w1d1-listening:line:0',
        speaker: 'Maya',
        text: "Hi, I'm Maya.",
        translationZh: '你好，我是 Maya。',
      },
    ],
    questions,
  }
}
