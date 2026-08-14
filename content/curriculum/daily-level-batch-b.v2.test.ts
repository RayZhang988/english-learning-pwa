import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe('QA-R17-003 content Batch B', () => {
  it('rebuilds six complete, progressively harder levels', () => {
    expect(() => execFileSync(process.execPath, ['content/curriculum/author-daily-level-batch-b.v2.mjs'], { encoding:'utf8' })).not.toThrow()
    expect(() => execFileSync(process.execPath, ['content/curriculum/validate-daily-level-batch-b.v2.mjs'], { encoding:'utf8' })).not.toThrow()
    const report = read('content/curriculum/daily-level-batch-b-quality-audit.v2.json')
    expect(report.levels).toHaveLength(6)
    expect(report.levels.every((level: { metrics: { count: number } }) => level.metrics.count === 200)).toBe(true)
    expect(report.crossLevelDuplicateFormsWithBatchA).toBe(0)
    expect(report.templateMaximums.sharedOpeningFourTokens).toBeLessThanOrEqual(6)
    expect(report.templateMaximums.sharedSkeleton).toBeLessThanOrEqual(8)
    expect(report.releaseStatus).toBe('candidate-blocked-until-batch-c')
  })

  it('maps every old B source without transferring evidence to rewritten content', () => {
    const migration = read('content/curriculum/daily-level-identity-migration-batch-b.v1.json')
    expect(migration.entries).toHaveLength(1203)
    expect(migration.entries.filter((row: { disposition: string }) => row.disposition === 'retired')).toHaveLength(825)
    expect(migration.entries.filter((row: { disposition: string }) => row.disposition.includes('equivalent'))).toHaveLength(378)
    expect(migration.entries.filter((row: { disposition: string; evidenceTransferAllowed: boolean }) => row.disposition === 'retired' && row.evidenceTransferAllowed)).toHaveLength(0)
  })

  it('keeps formal indexes untouched until Batch C and the complete migration exist', () => {
    const report = read('content/curriculum/daily-level-batch-b-quality-audit.v2.json')
    expect(report.remainingWork.formalIndexesRegenerated).toBe(false)
    const result = spawnSync(process.execPath, ['content/curriculum/audit-daily-level-quality.v2.mjs'], { encoding:'utf8' })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/blocked/u)
  })
})
