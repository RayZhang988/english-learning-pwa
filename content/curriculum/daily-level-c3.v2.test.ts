import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

const formalPublished = JSON.parse(readFileSync('content/curriculum/daily-level-rebuild-complete-handoff.v2.json', 'utf8')).formalIndexesRegenerated === true
describe.skipIf(formalPublished)('QA-R17-003 C3 高三候选内容', () => {
  it('通过内容、迁移、递进和反模板门禁', () => {
    expect(() => execFileSync(process.execPath, ['content/curriculum/author-daily-level-c3.v2.mjs'], { stdio: 'pipe' })).not.toThrow()
    expect(() => execFileSync(process.execPath, ['content/curriculum/validate-daily-level-c3.v2.mjs'], { stdio: 'pipe' })).not.toThrow()
  })
})
