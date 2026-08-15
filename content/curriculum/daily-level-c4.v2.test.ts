import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
describe('QA-R17-003 C4 CET4-reference content', () => {
  it('authors and validates 200 practical travel-English items without an official CET4 claim', () => {
    expect(() => execFileSync(process.execPath, ['content/curriculum/author-daily-level-c4.v2.mjs'], { stdio: 'pipe' })).not.toThrow()
    expect(() => execFileSync(process.execPath, ['content/curriculum/validate-daily-level-c4.v2.mjs'], { stdio: 'pipe' })).not.toThrow()
  })
})
