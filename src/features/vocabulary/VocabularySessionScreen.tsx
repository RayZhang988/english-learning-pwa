import { VocabularyTrainingScreen } from '../../ui/index.ts'
import type { VocabularySession } from './types.ts'
import { toVocabularyScreenViewModel } from './view-model.ts'

export function VocabularySessionScreen({
  session,
  operationPending,
  onExit,
  onSelect,
  onSubmit,
  onAdvance,
  onResume,
  onRetryTrainingContent,
}: {
  readonly session: VocabularySession
  readonly operationPending?: boolean
  readonly onExit: () => void
  readonly onSelect: (optionId: string) => void
  readonly onSubmit: () => void
  readonly onAdvance: () => void
  readonly onResume: () => void
  readonly onRetryTrainingContent?: () => void
}) {
  const viewModel = toVocabularyScreenViewModel(
    session,
    operationPending,
  )
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
      onRetryTrainingContent={onRetryTrainingContent}
    />
  )
}
