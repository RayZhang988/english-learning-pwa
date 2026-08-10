import {
  applyWrongAnswerEvidence,
  type WrongAnswerEvidence,
  type WrongAnswerLibraryState,
} from '../learning-engine/index.ts'
import type { ProductionReviewContentIndex } from './review-content-source.ts'

/**
 * The only legacy shape R13-D is allowed to import. A score, reviewItem,
 * target word, or summary is intentionally insufficient because none of them
 * proves the original scored question.
 */
export interface LegacyWrongAnswerCandidate {
  readonly schemaVersion: 1
  readonly aliasKey: string
  readonly evidence: WrongAnswerEvidence
}

export interface LegacyWrongAnswerMigrationResult {
  readonly state: WrongAnswerLibraryState
  readonly accepted: number
  readonly duplicates: number
  readonly rejected: number
}

function isCandidate(value: unknown): value is LegacyWrongAnswerCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<LegacyWrongAnswerCandidate>
  return candidate.schemaVersion === 1 && typeof candidate.aliasKey === 'string' && candidate.evidence !== undefined
}

export function migrateLegacyWrongAnswerCandidates(
  state: WrongAnswerLibraryState,
  values: readonly unknown[],
  index: ProductionReviewContentIndex,
): LegacyWrongAnswerMigrationResult {
  let next = state
  let accepted = 0
  let rejected = 0
  let duplicates = 0
  for (const value of values) {
    if (!isCandidate(value)) { rejected += 1; continue }
    const alias = index.aliases[value.aliasKey]
    const evidence = value.evidence
    if (!alias || evidence.schemaVersion !== 1 || evidence.outcome !== 'incorrect' || evidence.formallyScored !== true || evidence.reviewContentId !== alias.reviewContentId || evidence.originalQuestionType !== alias.originalQuestionType || evidence.domain !== alias.domain) { rejected += 1; continue }
    try {
      const result = applyWrongAnswerEvidence(next, evidence)
      next = result.state
      if (result.reason === 'accepted') accepted += 1
      else if (result.reason === 'duplicate') duplicates += 1
      else rejected += 1
    } catch {
      rejected += 1
    }
  }
  return { state: next, accepted, duplicates, rejected }
}
