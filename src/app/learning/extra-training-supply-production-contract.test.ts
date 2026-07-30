import { describe, expect, it } from 'vitest'
import {
  ListeningCatalogSupplyProvider,
  type ListeningCatalog,
  type ListeningQuestion,
  type ListeningTrainingUnit,
} from '../../features/listening/index.ts'
import {
  SpeakingCatalogSupplyProvider,
  type SpeakingCatalog,
  type SpeakingPrompt,
  type SpeakingTrainingUnit,
} from '../../features/speaking/index.ts'
import type {
  ExtraTrainingSupplyRequest,
  LearningTaskSupplyResult,
  TrainingModuleId,
} from '../../learning-engine/index.ts'

function request(
  moduleId: TrainingModuleId,
  priorityItemId: string,
): ExtraTrainingSupplyRequest {
  return {
    schemaVersion: 1,
    requestId: `extra:${moduleId}:supply:1`,
    sessionId: `extra:${moduleId}`,
    localDate: '2026-07-29',
    domain: moduleId,
    targetModuleId: moduleId,
    mode: 'learn',
    targetDifficulty: 1,
    cursor: null,
    excludeItemIds: [],
    priority: [
      'recent-error',
      'due-review',
      'same-day-variant',
      'new-optional-content',
    ],
    priorityItemIds: {
      'recent-error': [priorityItemId],
      'due-review': [],
      'same-day-variant': [],
      'new-optional-content': [],
    },
    reason: 'initial',
  }
}

async function invokeExtraRequest(
  provider: object & {
    readonly next: Function
  },
  value: ExtraTrainingSupplyRequest,
): Promise<LearningTaskSupplyResult> {
  return Reflect.apply(provider.next, provider, [value])
}

function listeningQuestion(id: string): ListeningQuestion {
  return {
    id,
    type: 'word-discrimination',
    promptZh: '选择听到的单词',
    primarySegmentId: `${id}:audio`,
    segments: [
      {
        id: `${id}:audio`,
        locale: 'en-US',
        text: id,
        label: '完整音频',
        speaker: null,
      },
    ],
    playbackPolicy: {
      allowSegmentSelection: false,
      allowRepeat: true,
      allowedRates: [1],
      sequenceMode: 'current-segment',
    },
    rationaleZh: '测试题',
    errorTag: 'sound-discrimination',
    options: [
      { id: `${id}:right`, label: id },
      { id: `${id}:wrong`, label: 'other' },
    ],
    correctOptionId: `${id}:right`,
  }
}

function listeningCatalog(): {
  readonly catalog: ListeningCatalog
  readonly index: unknown
} {
  const questions = [
    listeningQuestion('first'),
    listeningQuestion('priority'),
  ]
  const unit: ListeningTrainingUnit = {
    learningUnitId: 'listening-unit',
    contentRef: 'lesson://listening-unit',
    difficultyLevel: 1,
    estimatedSeconds: 120,
    tags: [],
    activityType: 'listening-dialogue',
    titleZh: '测试',
    transcript: [],
    questions,
  }
  return {
    catalog: {
      schemaVersion: 1,
      packageVersion: '1.0.0',
      extensionVersion: '1.1.0',
      courseId: 'test',
      units: [unit],
      getUnit(contentRef) {
        return contentRef === unit.contentRef ? unit : undefined
      },
    },
    index: {
      schemaVersion: 1,
      candidates: questions.map((question, index) => ({
        itemId:
          index === 0
            ? 'listening-first'
            : 'listening-priority',
        supplyOrder: index + 1,
        variantFamilyId: 'listening-unit',
        domain: 'listening',
        targetModuleId: 'listening',
        learningUnitId: unit.learningUnitId,
        contentRef: unit.contentRef,
        difficultyLevel: 1,
        tags: [],
        allowedModes: ['learn'],
        source: {
          sourceType: 'listening-extension',
          sourceId: question.id,
          variantId: 'word-discrimination',
        },
      })),
    },
  }
}

function speakingPrompt(id: string): SpeakingPrompt {
  return {
    id,
    cueZh: '请回答',
    partnerLine: 'Hello',
    modelAnswer: id,
    acceptedAnswers: [id],
    requiredConcepts: [id],
  }
}

function speakingCatalog(): {
  readonly catalog: SpeakingCatalog
  readonly index: unknown
} {
  const prompts = [
    speakingPrompt('first'),
    speakingPrompt('priority'),
  ]
  const unit: SpeakingTrainingUnit = {
    learningUnitId: 'speaking-unit',
    contentRef: 'lesson://speaking-unit',
    difficultyLevel: 1,
    estimatedSeconds: 120,
    tags: [],
    activityType: 'fixed-response',
    instructionsZh: '测试',
    prompts,
    scenePrompts: [],
  }
  return {
    catalog: {
      schemaVersion: 1,
      packageVersion: '1.0.0',
      courseId: 'survival-travel-american-4w',
      units: [unit],
      getUnit(contentRef) {
        return contentRef === unit.contentRef ? unit : undefined
      },
    },
    index: {
      schemaVersion: 1,
      candidates: prompts.map((prompt, index) => ({
        itemId:
          index === 0
            ? 'speaking-first'
            : 'speaking-priority',
        supplyOrder: index + 1,
        variantFamilyId: 'speaking-unit',
        domain: 'speaking',
        targetModuleId: 'speaking',
        learningUnitId: unit.learningUnitId,
        contentRef: unit.contentRef,
        difficultyLevel: 1,
        nominalEffectiveSeconds: 30,
        tags: [],
        allowedModes: ['learn'],
        source: {
          sourceType: 'speaking-prompt',
          sourceId: prompt.id,
          variantId: 'activity-prompt',
        },
      })),
    },
  }
}

describe('07/08 production supply contract for R6', () => {
  it('lets listening honor the exact recent-error item ID from 05', async () => {
    const fixture = listeningCatalog()
    const provider = new ListeningCatalogSupplyProvider(
      fixture.index,
      fixture.catalog,
    )

    const result = await invokeExtraRequest(
      provider,
      request('listening', 'listening-priority'),
    )

    expect(result).toMatchObject({
      status: 'item',
      item: { itemId: 'listening-priority' },
    })
  })

  it('lets speaking honor the exact recent-error item ID from 05', async () => {
    const fixture = speakingCatalog()
    const provider = new SpeakingCatalogSupplyProvider(
      fixture.index,
      fixture.catalog,
    )

    const result = await invokeExtraRequest(
      provider,
      request('speaking', 'speaking-priority'),
    )

    expect(result).toMatchObject({
      status: 'item',
      item: { itemId: 'speaking-priority' },
    })
  })
})
