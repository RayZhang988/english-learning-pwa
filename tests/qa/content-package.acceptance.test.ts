import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageIndex {
  schemaVersion: number
  packageVersion: string
  targetLocale: string
  manifestFile: string
  lessonFiles: string[]
  schemaFiles: string[]
  totals: {
    weeks: number
    lessons: number
    learningUnits: number
    vocabularyUnits: number
    listeningUnits: number
    speakingUnits: number
    sceneQuizItems: number
    candidateSeconds: number
  }
}

interface VocabularyItem {
  id: string
}

interface ChoiceCheck {
  id: string
  options: string[]
  correctOptionIndex: number
}

interface SpeakingPrompt {
  id: string
  modelAnswer: string
  acceptedAnswers: string[]
}

interface LearningUnit {
  learningUnitId: string
  contentRef: string
  domain: 'vocabulary' | 'listening' | 'speaking'
  estimatedSeconds: number
  prerequisiteUnitIds: string[]
  activity: {
    type: string
    items?: VocabularyItem[]
    reviewItemIds?: string[]
    transcript?: Array<{ text: string }>
    checks?: ChoiceCheck[]
    prompts?: SpeakingPrompt[]
    tts?: { locale: string }
  }
}

interface SceneQuizItem {
  id: string
  format: string
  options?: string[]
  correctOptionIndex?: number
  modelAnswer?: string
  acceptedAnswers?: string[]
}

interface Lesson {
  lessonId: string
  recommendedDay: number
  safetyNoteZh?: string
  learningUnits: LearningUnit[]
  sceneQuiz: SceneQuizItem[]
}

interface LessonWeek {
  lessons: Lesson[]
}

interface ExtensionOption {
  optionId: string
}

interface ExtensionExercise {
  exerciseId: string
  type: 'word-discrimination' | 'short-sentence-choice' | 'keyword-dictation'
  audioSource: {
    sourceType: 'tts-text' | 'transcript-line'
    segmentId: string
    locale: string
    baseContentRef?: string
    lineIndex?: number
    expectedText?: string
  }
  options?: ExtensionOption[]
  correctOptionId?: string
  standardAnswer?: string
  acceptedAnswers?: string[]
}

interface ExtensionLesson {
  lessonId: string
  recommendedDay: number
  listeningUnitId: string
  baseContentRef: string
  exercises: ExtensionExercise[]
  learningUnits?: unknown
  activity?: unknown
  transcript?: unknown
}

interface ListeningExtension {
  lessons: ExtensionLesson[]
}

const root = process.cwd()

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T
}

function expectUnique(values: readonly string[], label: string): void {
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  )
  expect(duplicates, `${label} contains duplicates`).toEqual([])
}

describe('05 released content package acceptance', () => {
  const packageIndex = readJson<PackageIndex>(
    'content/curriculum/package-index.v1.json',
  )
  const weeks = packageIndex.lessonFiles.map((path) =>
    readJson<LessonWeek>(path),
  )
  const lessons = weeks.flatMap((week) => week.lessons)
  const units = lessons.flatMap((lesson) => lesson.learningUnits)
  const quizzes = lessons.flatMap((lesson) => lesson.sceneQuiz)
  const unitById = new Map(units.map((unit) => [unit.learningUnitId, unit]))
  const dayByUnitId = new Map(
    lessons.flatMap((lesson) =>
      lesson.learningUnits.map(
        (unit) => [unit.learningUnitId, lesson.recommendedDay] as const,
      ),
    ),
  )

  it('publishes the declared package, manifest, schemas and four lesson files', () => {
    expect(packageIndex).toMatchObject({
      schemaVersion: 1,
      packageVersion: '1.0.0',
      targetLocale: 'en-US',
      totals: {
        weeks: 4,
        lessons: 28,
        learningUnits: 84,
        vocabularyUnits: 28,
        listeningUnits: 28,
        speakingUnits: 28,
        sceneQuizItems: 84,
        candidateSeconds: 75_600,
      },
    })
    expect(packageIndex.lessonFiles).toHaveLength(4)
    expect(packageIndex.schemaFiles).toHaveLength(3)

    for (const path of [
      packageIndex.manifestFile,
      ...packageIndex.lessonFiles,
      ...packageIndex.schemaFiles,
    ]) {
      expect(() => readJson<unknown>(path), path).not.toThrow()
    }
  })

  it('contains exactly 28 ordered days and three 15-minute domains per day', () => {
    expect(lessons.map((lesson) => lesson.recommendedDay)).toEqual(
      Array.from({ length: 28 }, (_, index) => index + 1),
    )

    for (const lesson of lessons) {
      expect(
        lesson.learningUnits.map((unit) => unit.domain).sort(),
        lesson.lessonId,
      ).toEqual(['listening', 'speaking', 'vocabulary'])
      expect(
        lesson.learningUnits.map((unit) => unit.estimatedSeconds),
        lesson.lessonId,
      ).toEqual([900, 900, 900])
      expect(
        lesson.learningUnits.reduce(
          (total, unit) => total + unit.estimatedSeconds,
          0,
        ),
        lesson.lessonId,
      ).toBe(2_700)
    }
  })

  it('keeps stable identifiers unique across the full package', () => {
    expectUnique(
      lessons.map((lesson) => lesson.lessonId),
      'lesson IDs',
    )
    expectUnique(
      units.map((unit) => unit.learningUnitId),
      'learning unit IDs',
    )
    expectUnique(
      units.map((unit) => unit.contentRef),
      'content refs',
    )

    const questionIds = [
      ...quizzes.map((quiz) => quiz.id),
      ...units.flatMap((unit) =>
        unit.activity.checks?.map((check) => check.id) ?? [],
      ),
      ...units.flatMap((unit) =>
        unit.activity.prompts?.map((prompt) => prompt.id) ?? [],
      ),
    ]
    expectUnique(questionIds, 'question and prompt IDs')
  })

  it('uses only earlier same-domain prerequisites without missing references', () => {
    for (const unit of units) {
      const unitDay = dayByUnitId.get(unit.learningUnitId)
      expect(unitDay).toBeTypeOf('number')

      for (const prerequisiteId of unit.prerequisiteUnitIds) {
        const prerequisite = unitById.get(prerequisiteId)
        const prerequisiteDay = dayByUnitId.get(prerequisiteId)
        expect(prerequisite, prerequisiteId).toBeDefined()
        expect(prerequisite?.domain).toBe(unit.domain)
        expect(prerequisiteDay).toBe((unitDay as number) - 1)
      }
    }
  })

  it('keeps choice answers, speaking answers and review references valid', () => {
    const vocabularyItems = new Map<string, number>()

    for (const lesson of lessons) {
      for (const unit of lesson.learningUnits) {
        for (const item of unit.activity.items ?? []) {
          expect(vocabularyItems.has(item.id), item.id).toBe(false)
          vocabularyItems.set(item.id, lesson.recommendedDay)
        }

        for (const reviewItemId of unit.activity.reviewItemIds ?? []) {
          const sourceDay = vocabularyItems.get(reviewItemId)
          expect(sourceDay, reviewItemId).toBeTypeOf('number')
          expect(sourceDay as number).toBeLessThan(lesson.recommendedDay)
        }

        for (const check of unit.activity.checks ?? []) {
          expect(check.correctOptionIndex).toBeGreaterThanOrEqual(0)
          expect(check.correctOptionIndex).toBeLessThan(check.options.length)
        }

        for (const prompt of unit.activity.prompts ?? []) {
          expect(prompt.acceptedAnswers).toContain(prompt.modelAnswer)
        }
      }

      for (const quiz of lesson.sceneQuiz) {
        if (
          quiz.format === 'single-choice' &&
          quiz.options &&
          quiz.correctOptionIndex !== undefined
        ) {
          expect(quiz.correctOptionIndex).toBeGreaterThanOrEqual(0)
          expect(quiz.correctOptionIndex).toBeLessThan(quiz.options.length)
        }
        if (quiz.format === 'fixed-response') {
          expect(quiz.acceptedAnswers).toContain(quiz.modelAnswer)
        }
      }
    }
  })

  it('has en-US content, no placeholders, and an honest emergency disclaimer', () => {
    const packageText = [
      readFileSync(resolve(root, packageIndex.manifestFile), 'utf8'),
      ...packageIndex.lessonFiles.map((path) =>
        readFileSync(resolve(root, path), 'utf8'),
      ),
    ].join('\n')

    expect(packageText).not.toMatch(
      /\b(?:TODO|TBD|PLACEHOLDER)\b|待补|占位内容/iu,
    )
    for (const unit of units) {
      if (unit.activity.tts) {
        expect(unit.activity.tts.locale).toBe('en-US')
      }
    }

    const emergencyLesson = lessons.find(
      (lesson) => lesson.recommendedDay === 23,
    )
    expect(emergencyLesson?.safetyNoteZh).toContain(
      '不提供医疗、法律或安全处置建议',
    )
    expect(JSON.stringify(emergencyLesson)).not.toMatch(
      /\b(?:911|112|999|110|120)\b/u,
    )
  })

  it('validates the additive listening extension and transcript references', () => {
    const extensionIndex = readJson<{
      exerciseBundleFiles: string[]
      schemaFiles: string[]
    }>('content/curriculum/listening-exercise-extension-index.v1.json')
    expect(extensionIndex.exerciseBundleFiles).toHaveLength(1)
    const extension = readJson<ListeningExtension>(
      extensionIndex.exerciseBundleFiles[0],
    )
    const extensionExercises = extension.lessons.flatMap(
      (lesson) => lesson.exercises,
    )

    expect(extensionIndex.schemaFiles).toHaveLength(3)
    for (const schemaFile of extensionIndex.schemaFiles) {
      expect(() => readJson<unknown>(schemaFile), schemaFile).not.toThrow()
    }
    expect(extension.lessons).toHaveLength(28)
    expect(extensionExercises).toHaveLength(84)
    expectUnique(
      extensionExercises.map((exercise) => exercise.exerciseId),
      'extension exercise IDs',
    )
    expectUnique(
      extensionExercises.map((exercise) => exercise.audioSource.segmentId),
      'extension segment IDs',
    )

    const typeCounts = new Map<string, number>()
    for (const exercise of extensionExercises) {
      typeCounts.set(exercise.type, (typeCounts.get(exercise.type) ?? 0) + 1)
      expect(exercise.audioSource.locale).toBe('en-US')

      if (exercise.options && exercise.correctOptionId) {
        expect(
          exercise.options.filter(
            (option) => option.optionId === exercise.correctOptionId,
          ),
        ).toHaveLength(1)
      }
      if (exercise.type === 'keyword-dictation') {
        expect(exercise.acceptedAnswers).toContain(exercise.standardAnswer)
      }

      if (exercise.audioSource.sourceType === 'transcript-line') {
        const baseUnit = units.find(
          (unit) =>
            unit.contentRef === exercise.audioSource.baseContentRef &&
            unit.domain === 'listening',
        )
        const referencedLine =
          baseUnit?.activity.transcript?.[exercise.audioSource.lineIndex ?? -1]
        expect(referencedLine?.text).toBe(exercise.audioSource.expectedText)
      }
    }

    expect(Object.fromEntries(typeCounts)).toEqual({
      'word-discrimination': 28,
      'short-sentence-choice': 28,
      'keyword-dictation': 28,
    })

    for (const lesson of extension.lessons) {
      expect(lesson.learningUnits).toBeUndefined()
      expect(lesson.activity).toBeUndefined()
      expect(lesson.transcript).toBeUndefined()
      expect(unitById.get(lesson.listeningUnitId)?.contentRef).toBe(
        lesson.baseContentRef,
      )
    }
  })
})
