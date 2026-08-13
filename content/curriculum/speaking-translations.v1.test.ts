import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

type SpeakingTranslationCandidate = {
  readonly id?: unknown
  readonly modelAnswer?: unknown
  readonly modelAnswerTranslationZh?: unknown
}

function loadSpeakingTranslationCandidates(): SpeakingTranslationCandidate[] {
  const candidates: SpeakingTranslationCandidate[] = []
  for (let week = 1; week <= 4; week += 1) {
    const document = JSON.parse(
      readFileSync(
        new URL(
          `../lessons/survival-travel-american-4w/week-${week}.v1.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      lessons: Array<{
        learningUnits: Array<{
          domain: string
          activity: { prompts?: SpeakingTranslationCandidate[] }
        }>
        sceneQuiz: Array<SpeakingTranslationCandidate & { domain: string }>
      }>
    }

    for (const lesson of document.lessons) {
      for (const unit of lesson.learningUnits) {
        if (unit.domain === 'speaking') {
          candidates.push(...(unit.activity.prompts ?? []))
        }
      }
      candidates.push(
        ...lesson.sceneQuiz.filter((item) => item.domain === 'speaking'),
      )
    }
  }
  return candidates
}

describe('R16 published speaking target translations', () => {
  it('covers every formal speaking prompt with a non-empty model-answer translation', () => {
    const candidates = loadSpeakingTranslationCandidates()

    expect(candidates).toHaveLength(900)
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(900)
    for (const candidate of candidates) {
      expect(candidate.modelAnswer).toEqual(expect.any(String))
      expect(candidate.modelAnswerTranslationZh).toEqual(expect.any(String))
      expect(
        String(candidate.modelAnswerTranslationZh).trim().length,
        `${String(candidate.id)} must publish a non-empty modelAnswerTranslationZh`,
      ).toBeGreaterThan(0)
    }
  })

  it('registers the translation validator in the package and production build gates', () => {
    const packageIndex = JSON.parse(
      readFileSync(new URL('./package-index.v1.json', import.meta.url), 'utf8'),
    ) as { validationFiles: string[] }
    const buildVerifier = readFileSync(
      new URL('../../src/app/learning/verify-course-build.mjs', import.meta.url),
      'utf8',
    )
    const validatorPath =
      'content/curriculum/validate-speaking-translations.v1.mjs'

    expect(packageIndex.validationFiles).toContain(validatorPath)
    expect(buildVerifier).toContain(
      "import '../../../content/curriculum/validate-speaking-translations.v1.mjs'",
    )
  })

  it('does not change wrong-answer identities for a non-scoring display translation', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ['content/curriculum/generate-review-content-index.v1.mjs', '--check'],
        { cwd: new URL('../../', import.meta.url), stdio: 'pipe' },
      ),
    ).not.toThrow()
  })
})
