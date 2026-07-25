import { describe, expect, it } from 'vitest'
import type { TrainingModuleId } from '../../learning-engine/index.ts'
import { projectLearningCandidates } from './course-candidate-source.ts'

const packageIndex = {
  schemaVersion: 1,
  packageVersion: '1.0.0',
  status: 'released',
  lessonFiles: ['content/lessons/week-1.json'],
}

function unit(
  day: number,
  domain: TrainingModuleId,
  prerequisites: readonly string[] = [],
) {
  return {
    learningUnitId: `st4w-w1d${day}-${domain}`,
    contentRef:
      `lesson://survival-travel-american-4w/1.0.0/w1d${day}/${domain}`,
    domain,
    difficultyLevel: 1,
    estimatedSeconds: 900,
    tags: [`day:${day}`],
    prerequisiteUnitIds: prerequisites,
    activity: {
      type:
        domain === 'vocabulary'
          ? 'vocabulary-set'
          : domain === 'listening'
            ? 'listening-dialogue'
            : 'fixed-response',
    },
  }
}

const documents = {
  packageIndex,
  lessonsByPath: {
    'content/lessons/week-1.json': {
      schemaVersion: 1,
      packageVersion: '1.0.0',
      lessons: [
        {
          learningUnits: [
            unit(1, 'vocabulary'),
            unit(1, 'listening'),
            unit(1, 'speaking'),
          ],
        },
        {
          learningUnits: [
            unit(2, 'vocabulary', ['st4w-w1d1-vocabulary']),
            unit(2, 'listening', ['st4w-w1d1-listening']),
            unit(2, 'speaking', ['st4w-w1d1-speaking']),
          ],
        },
      ],
    },
  },
}

describe('projectLearningCandidates', () => {
  it('uses durable completed unit IDs for prerequisites', () => {
    const candidates = projectLearningCandidates(
      documents,
      new Set(['st4w-w1d1-vocabulary']),
      new Set<TrainingModuleId>([
        'vocabulary',
        'listening',
        'speaking',
      ]),
    )

    expect(
      candidates.find(
        (candidate) =>
          candidate.learningUnitId === 'st4w-w1d2-vocabulary',
      )?.prerequisitesMet,
    ).toBe(true)
    expect(
      candidates.find(
        (candidate) =>
          candidate.learningUnitId === 'st4w-w1d2-listening',
      )?.prerequisitesMet,
    ).toBe(false)
  })

  it('excludes units whose target feature module is unavailable', () => {
    const candidates = projectLearningCandidates(
      documents,
      new Set(),
      new Set<TrainingModuleId>(['vocabulary', 'speaking']),
    )

    expect(
      candidates.some((candidate) => candidate.domain === 'listening'),
    ).toBe(false)
  })

  it('rejects missing prerequisite references', () => {
    const invalid = {
      packageIndex,
      lessonsByPath: {
        'content/lessons/week-1.json': {
          schemaVersion: 1,
          packageVersion: '1.0.0',
          lessons: [
            {
              learningUnits: [
                unit(2, 'vocabulary', ['missing-unit']),
              ],
            },
          ],
        },
      },
    }

    expect(() =>
      projectLearningCandidates(
        invalid,
        new Set(),
        new Set<TrainingModuleId>(['vocabulary']),
      ),
    ).toThrow('missing prerequisite')
  })
})
