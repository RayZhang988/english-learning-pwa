import { describe, expect, it, vi } from 'vitest'
import type { WrongAnswerEvidence } from '../learning-engine/index.ts'
import type { ProductionReviewContentIndex } from './review-content-source.ts'
import { ProductionWrongAnswerEvidencePorts } from './wrong-answer-evidence-production.ts'
import { loadReleasedReviewContentIndex } from './review-content-test-fixtures.ts'

async function index(): Promise<ProductionReviewContentIndex> { return loadReleasedReviewContentIndex() }
const evidence = (source: WrongAnswerEvidence['source']): WrongAnswerEvidence => ({ schemaVersion: 1, eventId: `e-${source}`, reviewContentId: 'r', originalQuestionType: 'choice', domain: 'vocabulary', source, outcome: 'incorrect', formallyScored: true, occurredAt: '2026-08-10T00:00:00.000Z' })

describe('01 unified wrong-answer producer composition', () => {
  it('routes vocabulary, listening, and speaking adapters into exactly one injected store', async () => {
    const publish = vi.fn(async (_value: WrongAnswerEvidence) => undefined)
    const ports = new ProductionWrongAnswerEvidencePorts({ load: index }, { publish })
    await ports.initialize()
    await ports.vocabulary.sink.publish(evidence('daily-training'))
    await ports.vocabulary.sink.publish(evidence('extra-training'))
    await ports.vocabulary.sink.publish(evidence('scenario-training'))
    await ports.publishListening(evidence('daily-training'))
    await ports.publishListening(evidence('extra-training'))
    await ports.speaking.sink.publishWrongAnswerEvidence(evidence('daily-training'))
    await ports.speaking.sink.publishWrongAnswerEvidence(evidence('extra-training'))
    expect(publish).toHaveBeenCalledTimes(7)
    expect(publish.mock.calls.map(([value]) => value.source)).toEqual([
      'daily-training', 'extra-training', 'scenario-training',
      'daily-training', 'extra-training', 'daily-training', 'extra-training',
    ])
  })
})
