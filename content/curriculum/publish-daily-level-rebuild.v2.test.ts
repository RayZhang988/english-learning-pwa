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
  it('builds the complete release in staging and produces the same digest twice', async () => {
    const first = await publishDailyLevelRebuild({ workspaceRoot, stagingParent: temporaryDirectory(), dryRun: true })
    const second = await publishDailyLevelRebuild({ workspaceRoot, stagingParent: temporaryDirectory(), dryRun: true })

    expect(first.formalIndexesRegenerated).toBe(true)
    expect(first.candidateRecords).toBe(3000)
    expect(first.levelCounts).toEqual(Object.fromEntries(first.levelOrder.map((level) => [level, 200])))
    expect(first.releaseDigest).toBe(second.releaseDigest)
    expect(first.trainingSupplyTotals.vocabularyCandidates).toBe(9000)
    expect(first.reviewTotals.dailyAliases).toBe(first.trainingSupplyTotals.allCandidates)
  }, 30_000)

  it('does not change a formal file when a staged generation fault is injected', async () => {
    const before = readFileSync(join(workspaceRoot, packageIndex), 'utf8')

    await expect(publishDailyLevelRebuild({
      workspaceRoot,
      stagingParent: temporaryDirectory(),
      dryRun: false,
      faultAfter: 'training-supply',
    })).rejects.toThrow('Injected publish fault after training-supply')

    expect(readFileSync(join(workspaceRoot, packageIndex), 'utf8')).toBe(before)
  }, 30_000)
})
