import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishDailyLevelRebuild } from './publish-daily-level-rebuild.v2.mjs'

const temporaryDirectories: string[] = []
const workspaceRoot = process.cwd()
const packageIndex = 'content/curriculum/package-index.v1.json'

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'daily-level-publish-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('QA-R17-003 atomic formal publisher', () => {
  it('validates the complete candidate and migration deterministically before generation', async () => {
    const first = await publishDailyLevelRebuild({ workspaceRoot, stagingParent: temporaryDirectory(), dryRun: true, validateOnly: true })
    const second = await publishDailyLevelRebuild({ workspaceRoot, stagingParent: temporaryDirectory(), dryRun: true, validateOnly: true })

    expect(first.formalIndexesRegenerated).toBe(false)
    expect(first.candidateRecords).toBe(3000)
    expect(first.levelCounts).toEqual(Object.fromEntries(first.levelOrder.map((level) => [level, 200])))
    expect(first.candidateDigest).toBe(second.candidateDigest)
    expect(first.migration.retired).toBe(2245)
    expect(first.migration.evidenceTransfers).toBe(760)
  })

  it('does not change a formal file when a staged generation fault is injected', async () => {
    const before = readFileSync(join(workspaceRoot, packageIndex), 'utf8')

    await expect(publishDailyLevelRebuild({
      workspaceRoot,
      stagingParent: temporaryDirectory(),
      dryRun: false,
      faultAfter: 'candidate-validation',
    })).rejects.toThrow('Injected publish fault after candidate-validation')

    expect(readFileSync(join(workspaceRoot, packageIndex), 'utf8')).toBe(before)
  })
})
