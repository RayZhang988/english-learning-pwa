import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = JSON.parse(fs.readFileSync(path.join(root, 'content/curriculum/wrong-answer-review-identity-migration.v1.json'), 'utf8'))

describe('wrong-answer review identity migration', () => {
  it('covers every prior alias exactly once with explicit safe dispositions', () => {
    expect(migration.totals).toEqual({ sourceAliases: 11_540, exactEquivalent: 2_280, retired: 6_735, unchanged: 2_525 })
    expect(new Set(migration.entries.map((entry: { sourceAlias: string }) => entry.sourceAlias)).size).toBe(11_540)
    expect(migration.entries.filter((entry: { disposition: string }) => entry.disposition === 'retired').every((entry: { targetReviewContentId?: string }) => !entry.targetReviewContentId)).toBe(true)
  })

  it('never crosses original question types and leaves scene identities unchanged', () => {
    for (const entry of migration.entries.filter((candidate: { disposition: string }) => candidate.disposition === 'exact-equivalent')) {
      expect(entry.targetAlias).toContain(entry.originalQuestionType.replace('vocabulary-', '').replace('term-to-meaning-choice', 'term-to-meaning-choice'))
    }
    const scenes = migration.entries.filter((entry: { sourceAlias: string }) => entry.sourceAlias.startsWith('scene:'))
    expect(scenes).toHaveLength(612)
    expect(scenes.every((entry: { disposition: string; sourceReviewContentId: string; targetReviewContentId: string }) => entry.disposition === 'unchanged' && entry.sourceReviewContentId === entry.targetReviewContentId)).toBe(true)
  })

  it('pins source and target hashes and a versioned policy', () => {
    expect(migration.mappingVersion).toBe('review-content-daily-v1-to-daily-v2')
    expect(migration.sourceDigest).toMatch(/^sha256-[a-f0-9]{64}$/u)
    expect(migration.targetDigest).toMatch(/^sha256-[a-f0-9]{64}$/u)
  })
})
