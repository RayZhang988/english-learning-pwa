import { describe, expect, it } from 'vitest'
import { createWrongAnswerLibraryState, type WrongAnswerEvidence } from '../learning-engine/index.ts'
import type { ProductionReviewContentIndex } from './review-content-source.ts'
import { migrateLegacyWrongAnswerCandidates } from './wrong-answer-legacy-migration.ts'

const alias = { reviewContentId: 'review-a', originalQuestionType: 'choice', domain: 'vocabulary' as const, source: { kind: 'daily-supply', itemId: 'item-a' } }
const index = { schemaVersion: 1, documentType: 'review-content-index', contentVersion: '1.0.0', aliases: { 'daily:item-a': alias } } as const satisfies ProductionReviewContentIndex
const evidence: WrongAnswerEvidence = { schemaVersion: 1, eventId: 'legacy-formal-incorrect', reviewContentId: 'review-a', originalQuestionType: 'choice', domain: 'vocabulary', source: 'daily-training', outcome: 'incorrect', formallyScored: true, occurredAt: '2026-08-10T00:00:00.000Z' }

describe('R13-D narrow legacy migration', () => {
  it('imports only a complete released alias plus formal incorrect evidence', () => {
    const result = migrateLegacyWrongAnswerCandidates(createWrongAnswerLibraryState(), [{ schemaVersion: 1, aliasKey: 'daily:item-a', evidence }], index)
    expect(result.accepted).toBe(1)
    expect(result.state.records['review-a::choice']?.incorrectCount).toBe(1)
  })
  it('rejects reviewItems, score summaries, target-only records and identity drift', () => {
    const result = migrateLegacyWrongAnswerCandidates(createWrongAnswerLibraryState(), [
      { reviewItems: { one: { incorrect: true } } },
      { correctCount: 1, incorrectCount: 3 },
      { targetText: 'passport', incorrect: true },
      { schemaVersion: 1, aliasKey: 'missing', evidence },
      { schemaVersion: 1, aliasKey: 'daily:item-a', evidence: { ...evidence, outcome: 'correct' } },
      { schemaVersion: 1, aliasKey: 'daily:item-a', evidence: { ...evidence, formallyScored: false } },
      { schemaVersion: 1, aliasKey: 'daily:item-a', evidence: { ...evidence, reviewContentId: 'drift' } },
    ], index)
    expect(result).toMatchObject({ accepted: 0, rejected: 7 })
    expect(result.state.records).toEqual({})
  })
})
