import { createStaticDataSource } from '../../core/testing/index.ts'
import { describe, expect, it } from 'vitest'
import packageIndex from '../../../content/curriculum/package-index.v1.json'
import manifest from '../../../content/curriculum/survival-travel-american-4w.v1.json'
import trainingSupplyIndex from '../../../content/curriculum/training-supply-index.v1/speaking.json'
import week1 from '../../../content/lessons/survival-travel-american-4w/week-1.v1.json'
import week2 from '../../../content/lessons/survival-travel-american-4w/week-2.v1.json'
import week3 from '../../../content/lessons/survival-travel-american-4w/week-3.v1.json'
import week4 from '../../../content/lessons/survival-travel-american-4w/week-4.v1.json'
import { createSpeakingCatalog } from './content.ts'
import { createSpeakingGrowthUpgradeAdapter } from './growth-upgrade.ts'
import type { SpeakingSupplyItem } from './types.ts'

function catalog() { return createSpeakingCatalog({ packageIndex, manifest, trainingSupplyIndex, lessonsByPath: { [packageIndex.lessonFiles[0]]: week1, [packageIndex.lessonFiles[1]]: week2, [packageIndex.lessonFiles[2]]: week3, [packageIndex.lessonFiles[3]]: week4 } }) }
function item(kind: 'speaking-prompt' | 'speaking-scene-quiz') { return (catalog().trainingSupplyIndex as { candidates: readonly SpeakingSupplyItem[] }).candidates.find((candidate) => candidate.source.sourceType === kind)! }

describe('speaking growth upgrade adapter', () => {
  it.each(['speaking-prompt', 'speaking-scene-quiz'] as const)('restores released %s prompt without leaking accepted answers', async (kind) => {
    const current = catalog(); const candidate = item(kind); const adapter = createSpeakingGrowthUpgradeAdapter(createStaticDataSource(current))
    const view = await adapter.resolve({ domain: 'speaking', itemId: candidate.itemId, expectedDifficultyLevel: candidate.difficultyLevel })
    expect(view).toMatchObject({ itemId: candidate.itemId, recording: { allowReferencePlaybackAfterRecording: true } })
    expect(JSON.stringify(view)).not.toContain('acceptedAnswers')
    expect(JSON.stringify(view)).not.toContain('modelAnswer')
  })

  it('returns finite content-match scoring and preserves unscorable recordings for retry', async () => {
    const current = catalog(); const candidate = item('speaking-prompt'); const adapter = createSpeakingGrowthUpgradeAdapter(createStaticDataSource(current))
    const prompt = await adapter.resolve({ domain: 'speaking', itemId: candidate.itemId, expectedDifficultyLevel: candidate.difficultyLevel, recordingExists: true })
    const correct = await adapter.submit({ domain: 'speaking', itemId: candidate.itemId, expectedDifficultyLevel: candidate.difficultyLevel, recognition: { status: 'recognized', transcript: prompt.referenceText!, alternatives: [] }, recording: { recordingId: 'r1', durationMs: 1000 } })
    expect(correct).toMatchObject({ scorable: true, correct: true, contentMatch: { state: 'recognized' } })
    const unavailable = await adapter.submit({ domain: 'speaking', itemId: candidate.itemId, expectedDifficultyLevel: candidate.difficultyLevel, recognition: { status: 'failed', code: 'no-speech', message: 'No speech' }, recording: { recordingId: 'r2', durationMs: 1000 } })
    expect(unavailable).toMatchObject({ scorable: false, retryable: true, contentMatch: { state: 'unscorable' }, recording: { recordingId: 'r2' } })
  })

  it('rejects non-speaking, scene foreign and cross-level identities', async () => {
    const candidate = item('speaking-prompt'); const adapter = createSpeakingGrowthUpgradeAdapter(createStaticDataSource(catalog()))
    await expect(adapter.resolve({ domain: 'listening', itemId: candidate.itemId, expectedDifficultyLevel: candidate.difficultyLevel })).rejects.toThrow('requires speaking domain')
    await expect(adapter.resolve({ domain: 'speaking', itemId: 'scene:hotel:question:1', expectedDifficultyLevel: candidate.difficultyLevel })).rejects.toThrow('not a released daily speaking item')
    await expect(adapter.resolve({ domain: 'speaking', itemId: candidate.itemId, expectedDifficultyLevel: candidate.difficultyLevel + 0.5 })).rejects.toThrow('does not match')
  })
})
