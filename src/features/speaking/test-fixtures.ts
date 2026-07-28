import type { LearningTask } from '../../learning-engine/index.ts'
import type {
  SpeakingCatalog,
  SpeakingPrompt,
  SpeakingTrainingUnit,
} from './types.ts'

export function createSpeakingTask(
  overrides: Partial<LearningTask> = {},
): LearningTask {
  return {
    schemaVersion: 1,
    taskId: 'task-speaking-1',
    planId: 'plan-1',
    sequence: 1,
    learningUnitId: 'st4w-w1d1-speaking',
    contentRef:
      'lesson://survival-travel-american-4w/1.0.0/w1d1/speaking',
    domain: 'speaking',
    targetModuleId: 'speaking',
    mode: 'learn',
    origin: 'new',
    difficultyLevel: 1,
    estimatedSeconds: 900,
    required: true,
    dueAt: null,
    skipLimit: 2,
    tags: ['scene:introductions', 'task:fixed-response'],
    ...overrides,
  }
}

export const speakingPrompt: SpeakingPrompt = {
  id: 'w1d1-s1',
  cueZh: '说明你来自上海。',
  partnerLine: 'Where are you from?',
  modelAnswer: "I'm from Shanghai.",
  acceptedAnswers: ["I'm from Shanghai.", 'I am from Shanghai.'],
  requiredConcepts: ['from', 'Shanghai'],
}

export function createSpeakingUnit(
  prompts: readonly SpeakingPrompt[] = [speakingPrompt],
): SpeakingTrainingUnit {
  return {
    learningUnitId: 'st4w-w1d1-speaking',
    contentRef:
      'lesson://survival-travel-american-4w/1.0.0/w1d1/speaking',
    difficultyLevel: 1,
    estimatedSeconds: 900,
    tags: ['scene:introductions', 'task:fixed-response'],
    activityType: 'fixed-response',
    instructionsZh: '用完整但简短的句子回答。',
    prompts,
    scenePrompts: [],
  }
}

export function createSpeakingCatalogFixture(
  unit = createSpeakingUnit(),
): SpeakingCatalog {
  return {
    schemaVersion: 1,
    packageVersion: '1.0.0',
    courseId: 'survival-travel-american-4w',
    units: [unit],
    getUnit: (contentRef) =>
      contentRef === unit.contentRef ? unit : undefined,
  }
}
