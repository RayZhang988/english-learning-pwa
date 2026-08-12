import { describe, expect, it } from 'vitest'
import manifest from '../../content/curriculum/training-supply-index.v1.json'
import vocabulary00 from '../../content/curriculum/training-supply-index.v1/vocabulary-00.json'
import listening from '../../content/curriculum/training-supply-index.v1/listening.json'
import speaking from '../../content/curriculum/training-supply-index.v1/speaking.json'
import { loadReleasedTrainingSupplyIndex } from './training-supply-index.ts'

const fixture: Record<string, unknown> = {
  'content/curriculum/training-supply-index.v1.json': manifest,
  'content/curriculum/training-supply-index.v1/vocabulary-00.json': vocabulary00,
  'content/curriculum/training-supply-index.v1/listening.json': listening,
  'content/curriculum/training-supply-index.v1/speaking.json': speaking,
}

describe('training supply manifest loader', () => {
  it('loads only a requested domain and preserves candidate order', async () => {
    const calls: string[] = []
    const index = await loadReleasedTrainingSupplyIndex(
      'content/curriculum/training-supply-index.v1.json',
      'listening',
      async (path) => { calls.push(path); return fixture[path]! },
    )
    expect(calls).toEqual([
      'content/curriculum/training-supply-index.v1.json',
      'content/curriculum/training-supply-index.v1/listening.json',
    ])
    expect(index.candidates).toHaveLength(listening.candidateCount)
    expect(index.candidates.every((candidate) => candidate.domain === 'listening')).toBe(true)
    expect(index.candidates.map((candidate) => candidate.supplyOrder)).toEqual([...index.candidates].map((candidate) => candidate.supplyOrder).sort((a, b) => Number(a) - Number(b)))
  })

  it('rejects a missing or tampered shard instead of silently changing a round', async () => {
    await expect(loadReleasedTrainingSupplyIndex(
      'content/curriculum/training-supply-index.v1.json', 'speaking',
      async (path) => path.endsWith('speaking.json') ? { ...speaking, candidates: [] } : fixture[path]!,
    )).rejects.toThrow('invalid or incomplete')
  })

  it('keeps accepting the retired monolith during cache migration', async () => {
    const legacy = { schemaVersion: 1, documentType: 'continuous-training-supply-index', candidates: [listening.candidates[0]] }
    await expect(loadReleasedTrainingSupplyIndex('legacy', 'listening', async () => legacy)).resolves.toBe(legacy)
  })
})
