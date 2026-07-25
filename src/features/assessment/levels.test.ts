import { describe, expect, it } from 'vitest'
import {
  describeInternalLevel,
  mapInternalLevelToCefr,
  roundInternalLevel,
} from './levels.ts'

describe('internal level mapping', () => {
  it.each([
    [0, 'pre-A1'],
    [1, 'A1'],
    [3.5, 'A2'],
    [5, 'B1'],
    [7.5, 'B2'],
    [9, 'C1'],
    [12, 'C2'],
  ] as const)('maps internal level %s to %s', (level, expected) => {
    expect(mapInternalLevelToCefr(level)).toBe(expected)
  })

  it('rounds to half levels and keeps the non-official wording', () => {
    expect(roundInternalLevel(6.26)).toBe(6.5)
    expect(describeInternalLevel(6.5)).toContain('非官方认证')
  })
})
