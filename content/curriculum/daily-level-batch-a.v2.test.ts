import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe('QA-R17-003 content Batch A', () => {
  it('rebuilds four complete levels and passes the strict candidate gate', () => {
    expect(() => execFileSync(process.execPath, ['content/curriculum/author-daily-level-batch-a.v2.mjs'], { encoding:'utf8' })).not.toThrow()
    expect(() => execFileSync(process.execPath, ['content/curriculum/validate-daily-level-batch-a.v2.mjs'], { encoding:'utf8' })).not.toThrow()
    const report = read('content/curriculum/daily-level-batch-a-quality-audit.v2.json')
    expect(report.levels).toHaveLength(4)
    expect(report.levels.every((level: { metrics: { count: number } }) => level.metrics.count === 200)).toBe(true)
    expect(report.crossLevelDuplicateForms).toBe(0)
    expect(report.releaseStatus).toBe('candidate-blocked-until-batches-b-and-c')
  })

  it('maps all old records without transferring evidence to rewritten content', () => {
    const migration = read('content/curriculum/daily-level-identity-migration-batch-a.v1.json')
    expect(migration.entries).toHaveLength(800)
    expect(migration.entries.filter((row: { disposition: string }) => row.disposition === 'retired')).toHaveLength(418)
    expect(migration.entries.filter((row: { disposition: string }) => row.disposition.includes('equivalent'))).toHaveLength(382)
    expect(migration.entries.filter((row: { disposition: string; evidenceTransferAllowed: boolean }) => row.disposition === 'retired' && row.evidenceTransferAllowed)).toHaveLength(0)
  })

  it('keeps the full released corpus blocked until B and C are rebuilt', () => {
    const result = spawnSync(process.execPath, ['content/curriculum/audit-daily-level-quality.v2.mjs'], { encoding:'utf8' })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/blocked/u)
  })
})
