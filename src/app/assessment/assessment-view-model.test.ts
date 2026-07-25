import { describe, expect, it } from 'vitest'
import {
  createPlacementAssessmentRuntime,
  placementBankV1,
  toPublicAssessmentItem,
} from '../../features/assessment/index.ts'
import type { RecorderViewModel } from '../../ui/index.ts'
import {
  toAssessmentPausedViewModel,
  toAssessmentQuestionViewModel,
  toAssessmentResultsViewModel,
} from './assessment-view-model.ts'

const readyRecorder: RecorderViewModel = {
  status: 'ready',
  statusLabel: '准备录音',
}

const presentation = {
  audioStatus: 'idle' as const,
  audioPlayCount: 0,
  recorder: readyRecorder,
  speechEvidenceReady: false,
  busy: false,
}

describe('assessment view-model integration', () => {
  it('maps an answer-free production choice item and explicit feedback action', async () => {
    const runtime = createPlacementAssessmentRuntime({
      now: () => '2026-07-25T01:00:00.000Z',
      createId: () => 'assessment-view-model',
    })
    const active = await runtime.start()
    const item = active.item
    if (!item || item.kind !== 'choice') {
      throw new Error('Expected the first production choice item.')
    }

    const activeViewModel = toAssessmentQuestionViewModel(
      active,
      item,
      presentation,
    )
    expect(activeViewModel.kind).toBe('choice')
    expect(JSON.stringify(activeViewModel)).not.toContain(
      'correctOptionId',
    )
    expect(activeViewModel.viewModel.primaryAction).toMatchObject({
      kind: 'submit',
      disabled: true,
    })

    runtime.selectChoice(item.id, item.options[0].id)
    const selected = runtime.state
    const selectedViewModel = toAssessmentQuestionViewModel(
      selected,
      item,
      presentation,
    )
    expect(selectedViewModel.viewModel.primaryAction.disabled).toBe(
      false,
    )

    const feedback = await runtime.submitChoice(item.id)
    expect(feedback.item).toBeNull()
    const feedbackViewModel = toAssessmentQuestionViewModel(
      feedback,
      item,
      presentation,
    )
    expect(feedbackViewModel.viewModel.primaryAction).toMatchObject({
      kind: 'continue',
      label: '继续下一题',
      disabled: false,
    })
    expect(feedbackViewModel.viewModel.submission).toMatchObject({
      itemId: item.id,
      status: 'recorded',
    })
  })

  it('maps restored pause and honest partial results', async () => {
    const runtime = createPlacementAssessmentRuntime({
      now: () => '2026-07-25T01:00:00.000Z',
      createId: () => 'assessment-paused-result',
    })
    await runtime.start()
    const paused = runtime.pause()
    const pausedViewModel = toAssessmentPausedViewModel(
      paused,
      false,
    )
    expect(pausedViewModel.resumeAction.disabled).toBe(false)
    expect(pausedViewModel.stopAction?.disabled).toBe(false)

    const completed = await runtime.stop()
    if (!completed.profile) {
      throw new Error('Expected a real partial ability profile.')
    }
    const results = toAssessmentResultsViewModel(completed.profile)
    expect(results.outcomeLabel).toBe('已保存部分结果')
    expect(results.abilities).toHaveLength(3)
    expect(
      results.abilities.every(
        (ability) => ability.levelLabel === '暂不估算',
      ),
    ).toBe(true)
  })

  it('maps example audio only for speech items that actually provide audioText', async () => {
    const runtime = createPlacementAssessmentRuntime({
      now: () => '2026-07-25T01:00:00.000Z',
      createId: () => 'assessment-speech-audio',
    })
    const active = await runtime.start()
    const repeatItem = placementBankV1.items.find(
      (item) => item.id === 'speak-repeat-04',
    )
    const readItem = placementBankV1.items.find(
      (item) => item.id === 'speak-read-03',
    )
    if (
      !repeatItem ||
      repeatItem.kind !== 'speech' ||
      !readItem ||
      readItem.kind !== 'speech'
    ) {
      throw new Error('Expected production speech items.')
    }
    const speakingState = {
      ...active,
      phase: 'speaking' as const,
      progress: {
        ...active.progress,
        phase: 'speaking' as const,
        domain: 'speaking' as const,
      },
      actions: {
        ...active.actions,
        canSelectChoice: false,
        canSubmitChoice: false,
        canSubmitSpeech: true,
      },
    }

    const repeat = toAssessmentQuestionViewModel(
      speakingState,
      toPublicAssessmentItem(repeatItem),
      {
        ...presentation,
        audioStatus: 'playing',
        audioPlayCount: 1,
      },
    )
    expect(repeat.kind).toBe('speech')
    if (repeat.kind === 'speech') {
      expect(repeat.viewModel.audio).toMatchObject({
        status: 'playing',
        playCountLabel: '1/2 次',
      })
    }

    const read = toAssessmentQuestionViewModel(
      speakingState,
      toPublicAssessmentItem(readItem),
      presentation,
    )
    expect(read.kind).toBe('speech')
    if (read.kind === 'speech') {
      expect(read.viewModel.audio).toBeUndefined()
    }
  })
})
