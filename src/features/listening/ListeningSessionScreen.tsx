import {
  ListeningTrainingScreen,
  type ListeningQuestionInputIntent,
  type ListeningRepeatMode,
} from '../../ui/index.ts'
import type { ListeningSession } from './types.ts'
import { toListeningScreenViewModel } from './view-model.ts'

export function ListeningSessionScreen({
  session,
  onExit,
  onToggleAudio,
  onRateChange,
  onSegmentChange,
  onRepeatModeChange,
  onSelect,
  onDictationChange,
  onSubmit,
  onAdvance,
  onResume,
}: {
  readonly session: ListeningSession
  readonly onExit: () => void
  readonly onToggleAudio: () => void
  readonly onRateChange: (rate: number) => void
  readonly onSegmentChange: (segmentId: string) => void
  readonly onRepeatModeChange: (mode: ListeningRepeatMode) => void
  readonly onSelect: (choiceId: string) => void
  readonly onDictationChange: (value: string) => void
  readonly onSubmit: () => void
  readonly onAdvance: () => void
  readonly onResume: () => void
}) {
  const viewModel = toListeningScreenViewModel(session)
  const onQuestionInput = (intent: ListeningQuestionInputIntent) => {
    if (intent.type === 'select-choice') {
      onSelect(intent.choiceId)
    } else {
      onDictationChange(intent.value)
    }
  }
  const onAction =
    session.phase === 'paused'
      ? onResume
      : session.phase === 'feedback'
        ? onAdvance
        : onSubmit

  return (
    <ListeningTrainingScreen
      viewModel={viewModel}
      onExit={onExit}
      onToggleAudio={onToggleAudio}
      onPlaybackRateChange={onRateChange}
      onSegmentChange={onSegmentChange}
      onRepeatModeChange={onRepeatModeChange}
      onQuestionInput={onQuestionInput}
      onAction={onAction}
    />
  )
}
