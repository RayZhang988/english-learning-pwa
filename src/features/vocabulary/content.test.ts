import { describe, expect, it } from 'vitest'
import type { LearningTask } from '../../learning-engine/index.ts'
import {
  createVocabularyCatalog,
  resolveVocabularyTask,
} from './content.ts'
import { VocabularyError } from './errors.ts'
import { buildVocabularyQuestions } from './questions.ts'
import {
  loadActualVocabularyDocuments,
  vocabularyTaskFor,
} from './test-fixtures.ts'

const structuredDurationEstimate = {
  schemaVersion: 1,
  estimateSeconds: 123,
  sampleCount: 0,
  basis: 'content-baseline',
  confidence: 'medium',
  contentType: 'vocabulary-set-v1',
  reasonableRangeSeconds: {
    lower: 90,
    upper: 600,
  },
  profileKey: 'vocabulary|learn|vocabulary-set-v1',
  baselineSource: 'structured-content',
} as const

describe('vocabulary course integration', () => {
  it('loads all 28 released vocabulary units through the package index', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )

    expect(catalog.schemaVersion).toBe(1)
    expect(catalog.packageVersion).toBe('1.0.0')
    expect(catalog.units).toHaveLength(28)
    expect(
      catalog.units.filter((unit) => unit.activityType === 'vocabulary-review'),
    ).toHaveLength(7)
    expect(
      catalog.units
        .filter((unit) => unit.activityType === 'vocabulary-review')
        .every((unit) => unit.reviewItems.length > 0),
    ).toBe(true)
  })

  it('builds every approved question type for every released unit', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )

    for (const unit of catalog.units) {
      const questions = buildVocabularyQuestions(unit)
      expect(new Set(questions.map((question) => question.type))).toEqual(
        new Set([
          'term-to-meaning',
          'meaning-to-term',
          'example-comprehension',
          'scene-word-choice',
        ]),
      )
      for (const question of questions) {
        expect(question.options.length).toBeGreaterThanOrEqual(2)
        expect(
          question.options.some(
            (option) => option.id === question.correctOptionId,
          ),
        ).toBe(true)
      }
    }
  // R17 expands the released vocabulary corpus through the senior-school and
  // university levels. Building every question variant remains intentional,
  // but no longer fits the pre-expansion 15-second test budget on CI/macOS.
  }, 180_000)

  it('accepts dynamic task duration metadata without treating it as course identity', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const unit = catalog.units[0]
    const legacyTask = vocabularyTaskFor(unit)
    const structuredTask = vocabularyTaskFor(unit, {
      estimatedSeconds: 123,
      durationEstimate: structuredDurationEstimate,
    })
    const additiveMetadataOmitted = vocabularyTaskFor(unit, {
      estimatedSeconds: 123,
    })

    expect(unit.estimatedSeconds).toBe(900)
    expect(resolveVocabularyTask(catalog, legacyTask)).toBe(unit)
    expect(resolveVocabularyTask(catalog, structuredTask)).toBe(unit)
    expect(resolveVocabularyTask(catalog, additiveMetadataOmitted)).toBe(unit)
    expect(
      buildVocabularyQuestions(
        resolveVocabularyTask(catalog, structuredTask),
      ),
    ).not.toHaveLength(0)
  })

  it('still rejects corrupted static course identity', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const unit = catalog.units[0]
    const task = vocabularyTaskFor(unit, {
      estimatedSeconds: 123,
      durationEstimate: structuredDurationEstimate,
    })
    const incompatibleTasks: readonly LearningTask[] = [
      { ...task, learningUnitId: `${task.learningUnitId}-wrong` },
      { ...task, difficultyLevel: task.difficultyLevel + 1 },
      { ...task, tags: [...task.tags, 'wrong-static-tag'] },
      { ...task, targetModuleId: 'listening' },
      { ...task, domain: 'listening' },
      { ...task, schemaVersion: 2 as 1 },
    ]

    for (const incompatibleTask of incompatibleTasks) {
      expect(() =>
        resolveVocabularyTask(catalog, incompatibleTask),
      ).toThrowError(VocabularyError)
    }
    expect(() =>
      resolveVocabularyTask(catalog, {
        ...task,
        contentRef: `${task.contentRef}:missing`,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'content-reference-missing',
      }),
    )
  })

  it('rejects an unknown course package version', async () => {
    const documents = await loadActualVocabularyDocuments()
    const packageIndex = structuredClone(
      documents.packageIndex,
    ) as Record<string, unknown>
    packageIndex.packageVersion = '2.0.0'

    expect(() =>
      createVocabularyCatalog({
        ...documents,
        packageIndex,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'content-version-unsupported',
      }),
    )
  })
})
