import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateSemanticMetadata } from './training-supply-semantic-metadata.v1.mjs'

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const manifest = read('content/curriculum/training-supply-index.v1.json')
const taxonomy = read('content/curriculum/training-supply-semantic-taxonomy.v1.json')
const index = {
  ...manifest,
  candidates: manifest.shards.flatMap((shard: { path: string }) => read(shard.path).candidates),
}

describe('R15 released semantic metadata', () => {
  it('covers every released candidate and keeps vocabulary question forms on one knowledge point', () => {
    expect(index.candidates.filter((item: { domain: string }) => item.domain === 'vocabulary')).toHaveLength(9015)
    expect(index.candidates.filter((item: { domain: string }) => item.domain === 'listening')).toHaveLength(1013)
    expect(index.candidates.filter((item: { domain: string }) => item.domain === 'speaking')).toHaveLength(900)
    expect(() => validateSemanticMetadata(index, taxonomy)).not.toThrow()

    const vocabulary = index.candidates.filter((item: { domain: string }) => item.domain === 'vocabulary')
    const sampleFamily = vocabulary.filter((item: { variantFamilyId: string }) => item.variantFamilyId === vocabulary[0].variantFamilyId)
    expect(sampleFamily).toHaveLength(3)
    expect(new Set(sampleFamily.map((item: { knowledgePointId: string }) => item.knowledgePointId)).size).toBe(1)
  })

  it('does not confuse a shared listening playback identity with one scoring target', () => {
    const byPlayback = new Map<string, Array<{ knowledgePointId: string }>>()
    for (const item of index.candidates.filter((value: { domain: string }) => value.domain === 'listening')) {
      const group = byPlayback.get(item.playbackContentId) ?? []
      group.push(item)
      byPlayback.set(item.playbackContentId, group)
    }
    expect([...byPlayback.values()].some((group) => group.length > 1 && new Set(group.map((item) => item.knowledgePointId)).size > 1)).toBe(true)
  })

  it('reports taxonomy coverage and rejects empty fields, duplicate IDs, unknown versions, and collapsed pools', () => {
    const rows = validateSemanticMetadata(index, taxonomy)
    expect(rows).toHaveLength(36)
    expect(rows.every((row) => row.categoryCount > 1 && row.maximumCategoryShare < 1)).toBe(true)
    expect(Math.max(...rows.filter((row) => row.domain === 'vocabulary').map((row) => row.fallbackRate))).toBeLessThan(0.12)

    const empty = structuredClone(index)
    empty.candidates[0].knowledgePointId = ''
    expect(() => validateSemanticMetadata(empty, taxonomy)).toThrow(/knowledgePointId/u)
    const duplicate = structuredClone(index)
    duplicate.candidates.push(structuredClone(duplicate.candidates[0]))
    expect(() => validateSemanticMetadata(duplicate, taxonomy)).toThrow(/itemId/u)
    const unknown = structuredClone(index)
    unknown.semanticMetadata.taxonomyVersion = '2.0.0'
    expect(() => validateSemanticMetadata(unknown, taxonomy)).toThrow(/Unknown semantic taxonomy/u)
    const collapsed = structuredClone(index)
    for (const item of collapsed.candidates) item.semanticCategoryId = 'semantic-v1:one-category'
    expect(() => validateSemanticMetadata(collapsed, taxonomy)).toThrow(/collapses/u)
  })

  it('recomputes released facts byte-for-byte deterministically', () => {
    const run = () => execFileSync(process.execPath, ['content/curriculum/validate-training-supply.v1.mjs'], { encoding: 'utf8' })
    expect(run()).toBe(run())
  }, 30_000)
})
