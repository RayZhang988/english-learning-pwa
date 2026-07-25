import { SpeakingTrainingScreen } from '../../ui/index.ts'
import type { SpeakingSession } from './types.ts'
import { toSpeakingScreenViewModel } from './view-model.ts'

export function SpeakingSessionScreen({
  session,
  onExit,
  onRecorderAction,
  onPlayback,
  onAction,
}: {
  readonly session: SpeakingSession
  readonly onExit: () => void
  readonly onRecorderAction: () => void
  readonly onPlayback: () => void
  readonly onAction: () => void
}) {
  return (
    <SpeakingTrainingScreen
      viewModel={toSpeakingScreenViewModel(session)}
      onExit={onExit}
      onRecorderAction={onRecorderAction}
      onPlayback={onPlayback}
      onAction={onAction}
    />
  )
}
