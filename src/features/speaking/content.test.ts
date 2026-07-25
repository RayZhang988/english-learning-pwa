import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import {
  createSpeakingCatalog,
  resolveSpeakingTask,
} from './content.ts'
import { createSpeakingTask } from './test-fixtures.ts'
import type { SpeakingContentDocuments } from './types.ts'

const lessonPaths = packageIndex.lessonFiles

function documents(): SpeakingContentDocuments {
  return {
    packageIndex,
    manifest,
    lessonsByPath: {
      [lessonPaths[0]]: week1,
      [lessonPaths[1]]: week2,
      [lessonPaths[2]]: week3,
      [lessonPaths[3]]: week4,
    },
  }
}

describe('speaking content catalog', () => {
  it('loads every released fixed response and guided roleplay unit', () => {
    const catalog = createSpeakingCatalog(documents())

    expect(catalog.units).toHaveLength(28)
    expect(
      catalog.units.filter(
        (unit) => unit.activityType === 'guided-roleplay',
      ),
    ).toHaveLength(7)
    expect(
      catalog.units.flatMap((unit) => unit.prompts),
    ).toHaveLength(94)
  })

  it('resolves only tasks whose id and content reference both match', () => {
    const catalog = createSpeakingCatalog(documents())

    expect(
      resolveSpeakingTask(catalog, createSpeakingTask()).learningUnitId,
    ).toBe('st4w-w1d1-speaking')
    expect(() =>
      resolveSpeakingTask(
        catalog,
        createSpeakingTask({ learningUnitId: 'wrong-unit' }),
      ),
    ).toThrow(/does not match/i)
    expect(() =>
      resolveSpeakingTask(
        catalog,
        createSpeakingTask({ targetModuleId: 'listening' }),
      ),
    ).toThrow(/only accepts speaking/i)
  })

  it('rejects unknown speaking activity types', () => {
    const changed = structuredClone(week1) as {
      lessons: {
        learningUnits: {
          domain: string
          activity: { type: string }
        }[]
      }[]
    }
    const speaking = changed.lessons[0].learningUnits.find(
      (unit) => unit.domain === 'speaking',
    )
    if (!speaking) {
      throw new Error('Expected a speaking unit fixture.')
    }
    speaking.activity.type = 'open-ai-dialogue'
    expect(() =>
      createSpeakingCatalog({
        ...documents(),
        lessonsByPath: {
          ...documents().lessonsByPath,
          [lessonPaths[0]]: changed,
        },
      }),
    ).toThrow(/not a supported speaking activity/i)
  })
})
