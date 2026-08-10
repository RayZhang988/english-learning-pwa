import { describe, expect, it } from 'vitest'
import { InMemoryPlatformEventSink } from '../../core/testing/index.ts'
import { createSpeakingTask } from './test-fixtures.ts'
import {
  sameSpeakingWrongAnswerEvidencePort,
  toSpeakingTrainingRuntimeOptions,
} from './SpeakingTrainingRoute.tsx'

const network = { current: () => 'online' as const, subscribe: () => () => undefined }
const base = { task: createSpeakingTask(), localDate: '2026-08-03', eventSink: new InMemoryPlatformEventSink(), onExit: () => undefined }

describe('SpeakingTrainingRoute wrong-answer injection', () => {
  it('passes the exact resolver/sink port through unchanged', () => {
    const port = { resolver: { resolveItem: () => ({ reviewContentId: 'a', originalQuestionType: 'prompt', domain: 'speaking' as const, source: { kind: 'daily-supply' as const, itemId: 'i', sourceId: 's', contentRef: 'c' } }), resolvePrompt: () => ({ reviewContentId: 'a', originalQuestionType: 'prompt', domain: 'speaking' as const, source: { kind: 'daily-supply' as const, itemId: 'i', sourceId: 's', contentRef: 'c' } }) }, sink: { publishWrongAnswerEvidence: async () => undefined } }
    expect(toSpeakingTrainingRuntimeOptions({ ...base, wrongAnswerEvidence: port }, network).wrongAnswerEvidence).toBe(port)
  })
  it('treats an evidence-port replacement as a runtime identity change', () => {
    const one = { resolver: {} as never, sink: {} as never }
    const two = { resolver: {} as never, sink: {} as never }
    expect(sameSpeakingWrongAnswerEvidencePort(one, one)).toBe(true)
    expect(sameSpeakingWrongAnswerEvidencePort(one, two)).toBe(false)
  })
  it('keeps runtime identity for a new wrapper around the same resolver/sink pair', () => {
    const resolver = {} as never
    const sink = {} as never
    expect(sameSpeakingWrongAnswerEvidencePort({ resolver, sink }, { resolver, sink })).toBe(true)
    expect(sameSpeakingWrongAnswerEvidencePort({ resolver, sink }, { resolver: {} as never, sink })).toBe(false)
    expect(sameSpeakingWrongAnswerEvidencePort({ resolver, sink }, { resolver, sink: {} as never })).toBe(false)
  })
  it('keeps the existing route behavior compatible without the optional port', () => {
    expect(toSpeakingTrainingRuntimeOptions(base, network).wrongAnswerEvidence).toBeUndefined()
    expect(sameSpeakingWrongAnswerEvidencePort(undefined, undefined)).toBe(true)
  })
})
