import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
import bilingualChoiceOptions from '../../../content/lessons/survival-travel-american-4w/listening-choice-bilingual-options.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import {
  createListeningCatalog,
  resolveListeningTask,
} from './content.ts'
import { createListeningTask } from './test-fixtures.ts'
import type { ListeningContentDocuments } from './types.ts'

const lessonPaths = packageIndex.lessonFiles
const bundlePath = extensionIndex.exerciseBundleFiles[0]

function documents(
  exerciseBundle: unknown = exercises,
): ListeningContentDocuments {
  return {
    packageIndex,
    manifest,
    extensionIndex,
    lessonsByPath: {
      [lessonPaths[0]]: week1,
      [lessonPaths[1]]: week2,
      [lessonPaths[2]]: week3,
      [lessonPaths[3]]: week4,
    },
    exerciseBundlesByPath: {
      [bundlePath]: exerciseBundle,
    },
    bilingualChoiceOptions,
  }
}

describe('listening content catalog', () => {
  it('joins the released core package and extension without guessing files', () => {
    const catalog = createListeningCatalog(documents())
    expect(catalog.units).toHaveLength(28)
    const questions = catalog.units.flatMap((unit) => unit.questions)
    expect(
      questions.filter((question) => question.type === 'word-discrimination'),
    ).toHaveLength(28)
    expect(
      questions.filter(
        (question) => question.type === 'short-sentence-choice',
      ),
    ).toHaveLength(84)
    expect(
      questions.filter((question) => question.type === 'keyword-dictation'),
    ).toHaveLength(788)
    expect(
      questions.filter((question) => question.type === 'core-information'),
    ).toHaveLength(85)
    expect(
      questions.filter(
        (question) => question.type === 'scene-comprehension',
      ),
    ).toHaveLength(28)
    const choiceQuestions = questions.filter(
      (question) => question.type !== 'keyword-dictation',
    )
    const options = choiceQuestions.flatMap((question) => question.options)
    expect(choiceQuestions).toHaveLength(225)
    expect(options).toHaveLength(675)
    expect(options.every(
      (option) =>
        option.label.trim().length > 0 &&
        option.translationZh?.trim().length,
    )).toBe(true)
    expect(options.some((option) => /[\u3400-\u9fff]/u.test(option.label)))
      .toBe(false)
  })

  it('keeps all released keyword-dictation answer guidance structured and non-answer-revealing', () => {
    const catalog = createListeningCatalog(documents())
    const dictations = catalog.units
      .flatMap((unit) => unit.questions)
      .filter((question) => question.type === 'keyword-dictation')

    expect(dictations).toHaveLength(788)
    expect(dictations.every((question) => (
      question.answerGuidance.answerType.length > 0 &&
      question.answerGuidance.guidanceZh.length > 0 &&
      question.answerGuidance.acceptedInputFormats.length > 0
    ))).toBe(true)
    expect(dictations[0]?.answerGuidance).toEqual({
      answerType: 'place-name',
      guidanceZh: '填写听到的英文城市名；使用英文单词输入。',
      acceptedInputFormats: ['english-words'],
    })
  })

  it('rejects missing or answer-revealing keyword-dictation guidance', () => {
    const missing = structuredClone(exercises) as {
      lessons: { exercises: Record<string, unknown>[] }[]
    }
    const missingGuidance = missing.lessons[0]?.exercises.find(
      (exercise) => exercise.type === 'keyword-dictation',
    )
    if (!missingGuidance) {
      throw new Error('Expected a keyword-dictation exercise fixture.')
    }
    delete missingGuidance.answerGuidance
    expect(() => createListeningCatalog(documents(missing))).toThrow(
      /answerGuidance/i,
    )

    const revealing = structuredClone(exercises) as {
      lessons: { exercises: Record<string, unknown>[] }[]
    }
    const revealingGuidance = revealing.lessons[0]?.exercises.find(
      (exercise) => exercise.type === 'keyword-dictation',
    )
    if (!revealingGuidance) {
      throw new Error('Expected a keyword-dictation exercise fixture.')
    }
    revealingGuidance.answerGuidance = {
      answerType: 'place-name',
      guidanceZh: '填写 Boston。',
      acceptedInputFormats: ['english-words'],
    }
    expect(() => createListeningCatalog(documents(revealing))).toThrow(
      /must not reveal an answer/i,
    )
  })

  it('resolves only matching listening tasks', () => {
    const catalog = createListeningCatalog(documents())
    const unit = resolveListeningTask(catalog, createListeningTask())
    expect(unit.learningUnitId).toBe('st4w-w1d1-listening')
    expect(unit.questions).toHaveLength(38)
    expect(() =>
      resolveListeningTask(
        catalog,
        createListeningTask({ targetModuleId: 'speaking' }),
      ),
    ).toThrow(/only accepts listening/i)
  })

  it('keeps dialogue speaker labels out of full-scene speech text', () => {
    const catalog = createListeningCatalog(documents())
    const dialogues = catalog.units.filter(
      (unit) => unit.activityType === 'listening-dialogue',
    )

    expect(dialogues).toHaveLength(21)
    expect(
      dialogues.reduce(
        (total, unit) => total + unit.transcript.length,
        0,
      ),
    ).toBe(143)

    for (const unit of dialogues) {
      const fullSceneQuestions = unit.questions.filter(
        (question) => question.type === 'core-information',
      )
      expect(fullSceneQuestions.length).toBeGreaterThan(0)
      for (const question of fullSceneQuestions) {
        expect(question.playbackPolicy).toMatchObject({
          sequenceMode: 'all-segments',
          allowSegmentSelection: true,
        })
        expect(
          question.segments.map(({ text, speaker }) => ({
            text,
            speaker,
          })),
        ).toEqual(
          unit.transcript.map(({ text, speaker }) => ({
            text,
            speaker,
          })),
        )
        for (const segment of question.segments) {
          expect(segment.text).not.toContain(
            `${segment.speaker ?? ''}:`,
          )
        }
      }
    }
  })

  it('rejects transcript-line extensions when expected text drifts', () => {
    const changed = structuredClone(exercises) as {
      lessons: {
        exercises: {
          audioSource: {
            sourceType: string
            expectedText?: string
          }
        }[]
      }[]
    }
    const sentenceExercise = changed.lessons[0].exercises.find(
      (exercise) =>
        exercise.audioSource.sourceType === 'transcript-line',
    )
    if (!sentenceExercise) {
      throw new Error('Expected a transcript-line exercise fixture.')
    }
    sentenceExercise.audioSource.expectedText = 'Changed text'
    expect(() => createListeningCatalog(documents(changed))).toThrow(
      /does not match its referenced transcript line/i,
    )
  })
})
