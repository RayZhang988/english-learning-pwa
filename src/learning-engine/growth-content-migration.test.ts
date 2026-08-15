import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyGrowthTrainingCompleted,
  createGrowthStateForProfile,
  getGrowthEligibility,
  migrateDailyGrowthEvidence,
  startGrowthUpgradeTest,
  submitGrowthUpgradeAnswer,
} from './index.ts'
import { abilityProfileR1 } from './test-fixtures.ts'

const root = resolve(import.meta.dirname, '../..')
const json = <T>(path: string): T => JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T
const migrationFiles = [
  'batch-a', 'batch-b', 'c1', 'c2', 'c3', 'c4', 'c5',
].map((name) => `content/curriculum/daily-level-identity-migration-${name}.v1.json`)
const contentFiles = [
  'batch-a', 'batch-b', 'c1', 'c2', 'c3', 'c4', 'c5',
].map((name) => `content/curriculum/daily-level-content-${name}.v2.json`)

type Mapping = { sourceDailyKnowledgeId: string; disposition: 'equivalent' | 'moved-equivalent' | 'retired'; targetDailyKnowledgeId?: string; evidenceTransferAllowed: boolean }
type Target = { dailyKnowledgeId: string; levelId: string }
const rubric = json<{ levels: { id: string; ordinal: number }[] }>('content/curriculum/daily-level-rubric.v2.json')
const ordinalByLevelId = new Map(rubric.levels.map((level) => [level.id, level.ordinal]))
const mappings = migrationFiles.flatMap((path) => json<{ entries: Mapping[] }>(path).entries)
const targets = contentFiles.flatMap((path) => json<{ records: Target[] }>(path).records).map((entry) => ({ dailyKnowledgeId: entry.dailyKnowledgeId, levelOrdinal: ordinalByLevelId.get(entry.levelId)! }))
const targetLevel = new Map(targets.map((entry) => [entry.dailyKnowledgeId, entry.levelOrdinal]))

function evidence(source: string, levelOrdinal: number, evidenceId = source) {
  return { evidenceId, domain: 'vocabulary' as const, dailyKnowledgeId: source, levelOrdinal, correctCount: 8, incorrectCount: 2 }
}

describe('QA-R17-003 daily growth evidence migration', () => {
  it('validates the real 3005-entry handoff and transfers exactly the approved 760 identities', () => {
    expect(mappings).toHaveLength(3005)
    expect(targets).toHaveLength(3000)
    const transferable = mappings.filter((entry) => entry.evidenceTransferAllowed)
    expect(transferable).toHaveLength(760)
    const inputEvidence = transferable.map((entry, index) => evidence(entry.sourceDailyKnowledgeId, entry.disposition === 'equivalent' ? targetLevel.get(entry.targetDailyKnowledgeId!)! : (targetLevel.get(entry.targetDailyKnowledgeId!)! + 1) % 15, `e-${index}`))
    const migrated = migrateDailyGrowthEvidence({ state: { schemaVersion: 1, migrationVersion: 'daily-level-v1-to-v2', evidence: inputEvidence }, expectedMigrationVersion: 'daily-level-v1-to-v2', mappings, targetIdentities: targets })
    expect(migrated.activeEvidence).toHaveLength(760)
    expect(migrated.activeEvidence.filter((entry) => entry.countsTowardUpgradeWindow)).toHaveLength(222)
    expect(migrated.activeEvidence.filter((entry) => !entry.countsTowardUpgradeWindow)).toHaveLength(538)
  })

  it('rebases moved exact equivalents to the new level without crediting the new upgrade window', () => {
    const mapping = mappings.find((entry) => entry.disposition === 'moved-equivalent')!
    const newLevel = targetLevel.get(mapping.targetDailyKnowledgeId!)!
    const oldLevel = (newLevel + 1) % 15
    const result = migrateDailyGrowthEvidence({ state: { schemaVersion: 1, migrationVersion: 'm', evidence: [evidence(mapping.sourceDailyKnowledgeId, oldLevel)] }, expectedMigrationVersion: 'm', mappings: [mapping], targetIdentities: [{ dailyKnowledgeId: mapping.targetDailyKnowledgeId!, levelOrdinal: newLevel }] })
    expect(result.activeEvidence[0]).toMatchObject({ sourceDailyKnowledgeId: mapping.sourceDailyKnowledgeId, dailyKnowledgeId: mapping.targetDailyKnowledgeId, levelOrdinal: newLevel, countsTowardUpgradeWindow: false })
  })

  it('keeps retired evidence as history and never transfers it into active growth', () => {
    const mapping = mappings.find((entry) => entry.disposition === 'retired')!
    const result = migrateDailyGrowthEvidence({ state: { schemaVersion: 1, migrationVersion: 'm', evidence: [evidence(mapping.sourceDailyKnowledgeId, 0)] }, expectedMigrationVersion: 'm', mappings: [mapping], targetIdentities: [] })
    expect(result.activeEvidence).toEqual([])
    expect(result.retiredEvidence).toEqual([expect.objectContaining({ dailyKnowledgeId: mapping.sourceDailyKnowledgeId, retirementReason: 'content-retired' })])
  })

  it('is idempotent and rejects missing, contradictory, duplicate or corrupt mappings', () => {
    const mapping = mappings.find((entry) => entry.disposition === 'equivalent')!
    const level = targetLevel.get(mapping.targetDailyKnowledgeId!)!
    const base = { state: { schemaVersion: 1 as const, migrationVersion: 'm', evidence: [evidence(mapping.sourceDailyKnowledgeId, level)] }, expectedMigrationVersion: 'm', mappings: [mapping], targetIdentities: [{ dailyKnowledgeId: mapping.targetDailyKnowledgeId!, levelOrdinal: level }] }
    const once = migrateDailyGrowthEvidence(base)
    expect(migrateDailyGrowthEvidence({ ...base, state: once })).toBe(once)
    expect(() => migrateDailyGrowthEvidence({ ...base, mappings: [] })).toThrow('no migration mapping')
    expect(() => migrateDailyGrowthEvidence({ ...base, mappings: [mapping, mapping] })).toThrow('duplicate source')
    expect(() => migrateDailyGrowthEvidence({ ...base, mappings: [{ ...mapping, evidenceTransferAllowed: false }] })).toThrow('contradicts')
    expect(() => migrateDailyGrowthEvidence({ ...base, targetIdentities: [] })).toThrow('unknown')
  })

  it('preserves all 15 level boundaries and the highest-level terminal rule with 200 real candidates each', () => {
    const counts = Array.from({ length: 15 }, (_, ordinal) => targets.filter((entry) => entry.levelOrdinal === ordinal).length)
    expect(counts).toEqual(Array(15).fill(200))
    const minimums = [0, 150, 300, 450, 600, 750, 900, 1_100, 1_300, 1_500, 1_750, 2_000, 2_250, 2_500, 2_850]
    for (let ordinal = 0; ordinal < 15; ordinal += 1) {
      const levelId = rubric.levels[ordinal]!.id as NonNullable<Parameters<typeof abilityProfileR1>[0]>['id']
      const minimumEstimatedWords = minimums[ordinal]!
      const growth = createGrowthStateForProfile(abilityProfileR1({ id: levelId, ordinal, minimumEstimatedWords, estimatedWords: minimumEstimatedWords, lower: minimumEstimatedWords, upper: minimumEstimatedWords + 100 }))
      expect(growth.domains.vocabulary.currentLevelOrdinal).toBe(ordinal)
      expect(getGrowthEligibility(growth, 'vocabulary').status).toBe(ordinal === 14 ? 'highest-level' : 'ineligible')
      expect(growth.domains.listening.currentLevelOrdinal).toBe(0)
      expect(growth.domains.speaking.currentLevelOrdinal).toBe(0)
    }
  })

  it('uses the unchanged 5-session/50-item/80% gate and 8-of-10 test at every adjacent boundary', () => {
    const minimums = [0, 150, 300, 450, 600, 750, 900, 1_100, 1_300, 1_500, 1_750, 2_000, 2_250, 2_500, 2_850]
    for (let ordinal = 0; ordinal < 14; ordinal += 1) {
      const levelId = rubric.levels[ordinal]!.id as NonNullable<Parameters<typeof abilityProfileR1>[0]>['id']
      let growth = createGrowthStateForProfile(abilityProfileR1({ id: levelId, ordinal, minimumEstimatedWords: minimums[ordinal], estimatedWords: minimums[ordinal], lower: minimums[ordinal], upper: minimums[ordinal]! + 100 }))
      for (let session = 0; session < 5; session += 1) {
        growth = applyGrowthTrainingCompleted(growth, { eventId: `event-${ordinal}-${session}`, source: 'daily-training', sessionId: `session-${ordinal}-${session}`, domain: 'vocabulary', levelOrdinal: ordinal, correctCount: 8, incorrectCount: 2, localDate: `2026-08-${String(session + 1).padStart(2, '0')}`, completedAt: `2026-08-${String(session + 1).padStart(2, '0')}T12:00:00.000Z` })
      }
      expect(getGrowthEligibility(growth, 'vocabulary').status).toBe('eligible')
      const nextLevelCandidates = targets.filter((entry) => entry.levelOrdinal === ordinal + 1).slice(0, 10).map((entry) => entry.dailyKnowledgeId)
      growth = startGrowthUpgradeTest(growth, { eventId: `start-${ordinal}`, domain: 'vocabulary', seed: ordinal + 1, candidateItemIds: nextLevelCandidates, startedAt: '2026-08-10T12:00:00.000Z' })
      for (let answer = 0; answer < 10; answer += 1) growth = submitGrowthUpgradeAnswer(growth, { eventId: `answer-${ordinal}-${answer}`, domain: 'vocabulary', index: answer, correct: answer < 8, answeredAt: '2026-08-10T12:01:00.000Z' })
      expect(growth.domains.vocabulary.currentLevelOrdinal).toBe(ordinal + 1)
    }
  })
})
