import { describe, expect, it } from 'vitest'
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
  })

  it('resolves only tasks that exactly match released content metadata', async () => {
    const catalog = createVocabularyCatalog(
      await loadActualVocabularyDocuments(),
    )
    const unit = catalog.units[0]
    const task = vocabularyTaskFor(unit)

    expect(resolveVocabularyTask(catalog, task)).toBe(unit)
    expect(() =>
      resolveVocabularyTask(catalog, {
        ...task,
        estimatedSeconds: task.estimatedSeconds + 1,
      }),
    ).toThrowError(VocabularyError)
    expect(() =>
      resolveVocabularyTask(catalog, {
        ...task,
        targetModuleId: 'listening',
      }),
    ).toThrowError(VocabularyError)
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
