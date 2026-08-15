import type { AbilityDomain } from './contracts.ts'

export const DAILY_GROWTH_EVIDENCE_MIGRATION_SCHEMA_VERSION = 2 as const

export type DailyGrowthMigrationDisposition =
  | 'equivalent'
  | 'moved-equivalent'
  | 'retired'

export interface DailyGrowthIdentityMigrationEntry {
  readonly sourceDailyKnowledgeId: string
  readonly disposition: DailyGrowthMigrationDisposition
  readonly targetDailyKnowledgeId?: string
  readonly evidenceTransferAllowed: boolean
}

export interface DailyGrowthTargetIdentity {
  readonly dailyKnowledgeId: string
  readonly levelOrdinal: number
}

export interface LegacyDailyGrowthEvidence {
  readonly evidenceId: string
  readonly domain: AbilityDomain
  readonly dailyKnowledgeId: string
  readonly levelOrdinal: number
  readonly correctCount: number
  readonly incorrectCount: number
}

export interface MigratedDailyGrowthEvidence extends LegacyDailyGrowthEvidence {
  readonly sourceDailyKnowledgeId: string
  /**
   * Cross-level exact equivalents remain useful historical evidence, but they
   * cannot satisfy the new level's upgrade window.  The learner must earn new
   * scored work at that level before taking its upgrade test.
   */
  readonly countsTowardUpgradeWindow: boolean
}

export interface RetiredDailyGrowthEvidence extends LegacyDailyGrowthEvidence {
  readonly retirementReason: 'content-retired'
}

export interface DailyGrowthEvidenceMigrationV1 {
  readonly schemaVersion: 1
  readonly migrationVersion: string
  readonly evidence: readonly LegacyDailyGrowthEvidence[]
}

export interface DailyGrowthEvidenceMigrationV2 {
  readonly schemaVersion: 2
  readonly migrationVersion: string
  readonly activeEvidence: readonly MigratedDailyGrowthEvidence[]
  readonly retiredEvidence: readonly RetiredDailyGrowthEvidence[]
}

export interface MigrateDailyGrowthEvidenceInput {
  readonly state: DailyGrowthEvidenceMigrationV1 | DailyGrowthEvidenceMigrationV2
  readonly expectedMigrationVersion: string
  readonly mappings: readonly DailyGrowthIdentityMigrationEntry[]
  readonly targetIdentities: readonly DailyGrowthTargetIdentity[]
}

const DOMAINS: readonly AbilityDomain[] = ['vocabulary', 'listening', 'speaking']

function nonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${name} is invalid`)
}

function ordinal(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 14) throw new TypeError(`${name} is invalid`)
}

function assertEvidence(value: LegacyDailyGrowthEvidence): void {
  nonEmpty(value.evidenceId, 'growth evidence id')
  nonEmpty(value.dailyKnowledgeId, 'growth knowledge id')
  if (!DOMAINS.includes(value.domain)) throw new TypeError('growth evidence domain is invalid')
  ordinal(value.levelOrdinal, 'growth evidence level')
  if (!Number.isInteger(value.correctCount) || value.correctCount < 0 || !Number.isInteger(value.incorrectCount) || value.incorrectCount < 0 || value.correctCount + value.incorrectCount === 0) throw new TypeError('growth evidence score is invalid')
}

/**
 * Migrates only identity-addressable daily growth evidence. Aggregate R17
 * level/progress state is deliberately left untouched: an old level is never
 * silently reset or downgraded, while the normal next-level test remains the
 * only operation that can increase it.
 */
export function migrateDailyGrowthEvidence(
  input: MigrateDailyGrowthEvidenceInput,
): DailyGrowthEvidenceMigrationV2 {
  nonEmpty(input.expectedMigrationVersion, 'expected migration version')
  if (input.state.schemaVersion === DAILY_GROWTH_EVIDENCE_MIGRATION_SCHEMA_VERSION) {
    if (input.state.migrationVersion !== input.expectedMigrationVersion) throw new TypeError('growth evidence migration version does not match')
    return input.state
  }
  if (input.state.schemaVersion !== 1 || input.state.migrationVersion !== input.expectedMigrationVersion) throw new TypeError('growth evidence source version does not match')

  const targetById = new Map<string, number>()
  for (const target of input.targetIdentities) {
    nonEmpty(target.dailyKnowledgeId, 'target knowledge id')
    ordinal(target.levelOrdinal, 'target level')
    if (targetById.has(target.dailyKnowledgeId)) throw new TypeError('duplicate target knowledge id')
    targetById.set(target.dailyKnowledgeId, target.levelOrdinal)
  }
  const mappingBySource = new Map<string, DailyGrowthIdentityMigrationEntry>()
  for (const mapping of input.mappings) {
    nonEmpty(mapping.sourceDailyKnowledgeId, 'source knowledge id')
    if (mappingBySource.has(mapping.sourceDailyKnowledgeId)) throw new TypeError('duplicate source migration mapping')
    const transferable = mapping.disposition === 'equivalent' || mapping.disposition === 'moved-equivalent'
    if (mapping.evidenceTransferAllowed !== transferable) throw new TypeError('migration transfer permission contradicts disposition')
    if (transferable) {
      nonEmpty(mapping.targetDailyKnowledgeId, 'mapped target knowledge id')
      if (!targetById.has(mapping.targetDailyKnowledgeId)) throw new TypeError('mapped target knowledge id is unknown')
    } else if (mapping.targetDailyKnowledgeId !== undefined) {
      throw new TypeError('retired migration cannot name a target')
    }
    mappingBySource.set(mapping.sourceDailyKnowledgeId, mapping)
  }

  const evidenceIds = new Set<string>()
  const activeEvidence: MigratedDailyGrowthEvidence[] = []
  const retiredEvidence: RetiredDailyGrowthEvidence[] = []
  for (const evidence of input.state.evidence) {
    assertEvidence(evidence)
    if (evidenceIds.has(evidence.evidenceId)) throw new TypeError('duplicate growth evidence id')
    evidenceIds.add(evidence.evidenceId)
    const mapping = mappingBySource.get(evidence.dailyKnowledgeId)
    if (!mapping) throw new TypeError('growth evidence has no migration mapping')
    if (mapping.disposition === 'retired') {
      retiredEvidence.push({ ...evidence, retirementReason: 'content-retired' })
      continue
    }
    const targetId = mapping.targetDailyKnowledgeId!
    const targetLevel = targetById.get(targetId)!
    if (mapping.disposition === 'equivalent' && targetLevel !== evidence.levelOrdinal) throw new TypeError('equivalent migration changed level')
    if (mapping.disposition === 'moved-equivalent' && targetLevel === evidence.levelOrdinal) throw new TypeError('moved-equivalent migration did not change level')
    activeEvidence.push({
      ...evidence,
      sourceDailyKnowledgeId: evidence.dailyKnowledgeId,
      dailyKnowledgeId: targetId,
      levelOrdinal: targetLevel,
      countsTowardUpgradeWindow: mapping.disposition === 'equivalent',
    })
  }
  return {
    schemaVersion: DAILY_GROWTH_EVIDENCE_MIGRATION_SCHEMA_VERSION,
    migrationVersion: input.expectedMigrationVersion,
    activeEvidence,
    retiredEvidence,
  }
}
