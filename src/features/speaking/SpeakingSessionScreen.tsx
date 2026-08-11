import { SpeakingTrainingScreen } from '../../ui/index.ts'
import type { SpeakingSession } from './types.ts'
import { toSpeakingScreenViewModel } from './view-model.ts'

export function SpeakingSessionScreen({
  session,
  onExit,
  onRecorderAction,
  onPlayback,
  onOriginalPlayback,
  onAction,
}: {
  readonly session: SpeakingSession
  readonly onExit: () => void
  readonly onRecorderAction: () => void
  readonly onPlayback: () => void
  readonly onOriginalPlayback: () => void
  readonly onAction: () => void
}) {
  return (
    <SpeakingTrainingScreen
      viewModel={toSpeakingScreenViewModel(session)}
      onExit={onExit}
      onRecorderAction={onRecorderAction}
      onPlayback={onPlayback}
      onSecondaryAction={onOriginalPlayback}
      onAction={onAction}
    />
  )
}
