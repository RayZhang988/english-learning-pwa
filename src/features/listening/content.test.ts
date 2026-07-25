import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import extensionIndex from '../../../content/curriculum/listening-exercise-extension-index.v1.json'
import exercises from '../../../content/lessons/survival-travel-american-4w/listening-exercises.v1.json'
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
    ).toHaveLength(28)
    expect(
      questions.filter((question) => question.type === 'keyword-dictation'),
    ).toHaveLength(28)
    expect(
      questions.filter((question) => question.type === 'core-information'),
    ).toHaveLength(85)
    expect(
      questions.filter(
        (question) => question.type === 'scene-comprehension',
      ),
    ).toHaveLength(28)
  })

  it('resolves only matching listening tasks', () => {
    const catalog = createListeningCatalog(documents())
    const unit = resolveListeningTask(catalog, createListeningTask())
    expect(unit.learningUnitId).toBe('st4w-w1d1-listening')
    expect(unit.questions).toHaveLength(7)
    expect(() =>
      resolveListeningTask(
        catalog,
        createListeningTask({ targetModuleId: 'speaking' }),
      ),
    ).toThrow(/only accepts listening/i)
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
