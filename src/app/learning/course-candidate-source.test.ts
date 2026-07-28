import { describe, expect, it } from 'vitest'
import type {
  TaskDurationBaseline,
  TrainingModuleId,
} from '../../learning-engine/index.ts'
import { projectLearningCandidates } from './course-candidate-source.ts'

const packageIndex = {
  schemaVersion: 1,
  packageVersion: '1.0.0',
  status: 'released',
  lessonFiles: ['content/lessons/week-1.json'],
}

function durationBaseline(
  day: number,
  domain: TrainingModuleId,
): TaskDurationBaseline {
  if (domain === 'vocabulary') {
    return {
      schemaVersion: 1,
      contentType: 'vocabulary-set',
      fixedSeconds: 20,
      itemCount: day + 3,
      secondsPerItem: 18,
      activeAudioSeconds: 0,
      expectedAudioPlaythroughs: 0,
      interactionStepCount: (day + 3) * 2,
      secondsPerInteractionStep: 3,
      minimumSeconds: 60,
      maximumSeconds: 600,
    }
  }
  if (domain === 'listening') {
    return {
      schemaVersion: 1,
      contentType: 'listening-dialogue',
      fixedSeconds: 20,
      itemCount: day + 5,
      secondsPerItem: 15,
      activeAudioSeconds: 40 + day,
      expectedAudioPlaythroughs: 1,
      interactionStepCount: (day + 5) * 2,
      secondsPerInteractionStep: 3,
      minimumSeconds: 90,
      maximumSeconds: 900,
    }
  }
  return {
    schemaVersion: 1,
    contentType: 'fixed-response',
    fixedSeconds: 30,
    itemCount: day + 2,
    secondsPerItem: 30,
    activeAudioSeconds: 0,
    expectedAudioPlaythroughs: 0,
    interactionStepCount: (day + 2) * 3,
    secondsPerInteractionStep: 4,
    minimumSeconds: 90,
    maximumSeconds: 900,
  }
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
    durationBaseline: durationBaseline(day, domain),
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
  it('projects an authored structured baseline without treating the legacy estimate as truth', () => {
    const candidates = projectLearningCandidates(
      documents,
      new Set(),
      new Set<TrainingModuleId>([
        'vocabulary',
        'listening',
        'speaking',
      ]),
    )

    expect(candidates).toHaveLength(6)
    expect(
      candidates.map((candidate) => candidate.estimatedSeconds),
    ).toEqual([900, 900, 900, 900, 900, 900])
    expect(
      candidates.map((candidate) => candidate.durationBaseline),
    ).toEqual([
      durationBaseline(1, 'vocabulary'),
      durationBaseline(1, 'listening'),
      durationBaseline(1, 'speaking'),
      durationBaseline(2, 'vocabulary'),
      durationBaseline(2, 'listening'),
      durationBaseline(2, 'speaking'),
    ])
  })

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

  it('rejects an authored baseline that violates the engine contract', () => {
    const invalidUnit = unit(1, 'listening')
    const invalid = {
      packageIndex,
      lessonsByPath: {
        'content/lessons/week-1.json': {
          schemaVersion: 1,
          packageVersion: '1.0.0',
          lessons: [
            {
              learningUnits: [
                {
                  ...invalidUnit,
                  durationBaseline: {
                    ...invalidUnit.durationBaseline,
                    activeAudioSeconds: -1,
                  },
                },
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
        new Set<TrainingModuleId>(['listening']),
      ),
    ).toThrow('durationBaseline is invalid')
  })
})
