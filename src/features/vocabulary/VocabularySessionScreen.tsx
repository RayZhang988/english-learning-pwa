import { VocabularyTrainingScreen } from '../../ui/index.ts'
import type { VocabularySession } from './types.ts'
import { toVocabularyScreenViewModel } from './view-model.ts'

export function VocabularySessionScreen({
  session,
  onExit,
  onSelect,
  onSubmit,
  onAdvance,
  onResume,
}: {
  readonly session: VocabularySession
  readonly onExit: () => void
  readonly onSelect: (optionId: string) => void
  readonly onSubmit: () => void
  readonly onAdvance: () => void
  readonly onResume: () => void
}) {
  const viewModel = toVocabularyScreenViewModel(session)
  const onAction =
    session.phase === 'paused'
      ? onResume
      : session.phase === 'feedback'
        ? onAdvance
        : onSubmit

  return (
    <VocabularyTrainingScreen
      viewModel={viewModel}
      onExit={onExit}
      onSelect={onSelect}
      onAction={onAction}
    />
  )
}
