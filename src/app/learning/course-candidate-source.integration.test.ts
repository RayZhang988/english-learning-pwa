import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { TrainingModuleId } from '../../learning-engine/index.ts'
import {
  CurrentCourseCandidateSource,
} from './course-candidate-source.ts'

const fileFetcher = (async (input: URL | RequestInfo) => {
  const value =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input
  const url = new URL(value)
  if (url.protocol !== 'file:') {
    return new Response(null, { status: 404 })
  }
  return new Response(await readFile(url, 'utf8'), { status: 200 })
}) as typeof fetch

const modules = new Set<TrainingModuleId>([
  'vocabulary',
  'listening',
  'speaking',
])

describe('CurrentCourseCandidateSource released package', () => {
  it('loads all 84 real units and unlocks only satisfied prerequisite chains', async () => {
    const source = new CurrentCourseCandidateSource(fileFetcher)
    const initial = await source.load(new Set(), modules)

    expect(initial).toHaveLength(84)
    expect(
      initial.filter((candidate) => candidate.prerequisitesMet),
    ).toHaveLength(3)

    const completedDayOne = new Set(
      initial
        .filter((candidate) => candidate.prerequisitesMet)
        .map((candidate) => candidate.learningUnitId),
    )
    const next = await source.load(completedDayOne, modules)
    expect(
      next.filter((candidate) => candidate.prerequisitesMet),
    ).toHaveLength(6)
    expect(
      next.filter(
        (candidate) =>
          candidate.prerequisitesMet &&
          candidate.learningUnitId.includes('w1d2'),
      ),
    ).toHaveLength(3)
  })
})
