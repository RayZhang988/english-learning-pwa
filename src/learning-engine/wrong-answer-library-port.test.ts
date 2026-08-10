import { describe, expectTypeOf, it } from 'vitest'
import type {
  WrongAnswerLibraryState,
  WrongAnswerLibraryStatePort,
  WrongAnswerLibraryStateTransform,
  WrongAnswerRecord,
} from './index.ts'

describe('R13-D atomic wrong-answer state port contract', () => {
  it('loads current state and atomically applies a synchronous transform', () => {
    expectTypeOf<WrongAnswerLibraryStatePort['load']>()
      .returns.toEqualTypeOf<Promise<WrongAnswerLibraryState>>()
    expectTypeOf<Parameters<WrongAnswerLibraryStatePort['update']>[0]>()
      .toEqualTypeOf<WrongAnswerLibraryStateTransform>()
    expectTypeOf<ReturnType<WrongAnswerLibraryStatePort['update']>>()
      .toEqualTypeOf<Promise<WrongAnswerLibraryState>>()
    expectTypeOf<ReturnType<WrongAnswerLibraryStateTransform>>()
      .toEqualTypeOf<WrongAnswerLibraryState>()
  })

  it('requires every record to declare its history transition time', () => {
    const missingHistoryTransition = {
      schemaVersion: 1 as const,
      recordId: 'review::choice',
      reviewContentId: 'review',
      originalQuestionType: 'choice',
      domain: 'vocabulary' as const,
      status: 'active' as const,
      incorrectCount: 1,
      consecutiveReviewCorrect: 0 as const,
      lastIncorrectAt: '2026-08-10T00:00:00.000Z',
      lastSource: 'daily-training' as const,
      sources: ['daily-training'] as const,
    }
    // @ts-expect-error persisted wrong-answer records must explicitly store null or the exact history time
    const rejected: WrongAnswerRecord = missingHistoryTransition
    expectTypeOf(rejected).toEqualTypeOf<WrongAnswerRecord>()
  })
})
