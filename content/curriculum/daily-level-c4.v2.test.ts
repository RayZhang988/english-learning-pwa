import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
const formalPublished = JSON.parse(readFileSync('content/curriculum/daily-level-rebuild-complete-handoff.v2.json', 'utf8')).formalIndexesRegenerated === true
describe.skipIf(formalPublished)('QA-R17-003 C4 CET4-reference candidate content', () => {
  it('authors and validates 200 practical travel-English items without an official CET4 claim', () => {
    expect(() => execFileSync(process.execPath, ['content/curriculum/author-daily-level-c4.v2.mjs'], { stdio: 'pipe' })).not.toThrow()
    expect(() => execFileSync(process.execPath, ['content/curriculum/validate-daily-level-c4.v2.mjs'], { stdio: 'pipe' })).not.toThrow()
  })
})
