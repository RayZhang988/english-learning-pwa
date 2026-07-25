import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons.tsx'

export interface SystemActionViewModel {
  readonly label: string
  readonly disabled?: boolean
}

export interface SystemStateViewModel {
  readonly title: string
  readonly description: string
  readonly icon: IconName
  readonly tone: 'info' | 'success' | 'warning' | 'error' | 'quiet'
  readonly primaryAction?: SystemActionViewModel
  readonly secondaryAction?: SystemActionViewModel
}

export function SystemStateCard({
  viewModel,
  onPrimaryAction,
  onSecondaryAction,
  children,
}: {
  readonly viewModel: SystemStateViewModel
  readonly onPrimaryAction?: () => void
  readonly onSecondaryAction?: () => void
  readonly children?: ReactNode
}) {
  return (
    <section
      className={`system-state-card system-state-card--${viewModel.tone}`}
      role={viewModel.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="system-state-card__icon">
        <Icon name={viewModel.icon} />
      </span>
      <div className="system-state-card__copy">
        <h2>{viewModel.title}</h2>
        <p>{viewModel.description}</p>
      </div>
      {children}
      {viewModel.primaryAction && onPrimaryAction ? (
        <button
          className="primary-button"
          type="button"
          disabled={viewModel.primaryAction.disabled}
          onClick={onPrimaryAction}
        >
          {viewModel.primaryAction.label}
        </button>
      ) : null}
      {viewModel.secondaryAction && onSecondaryAction ? (
        <button
          className="text-button"
          type="button"
          disabled={viewModel.secondaryAction.disabled}
          onClick={onSecondaryAction}
        >
          {viewModel.secondaryAction.label}
        </button>
      ) : null}
    </section>
  )
}

export function SystemBanner({
  viewModel,
  onAction,
  onDismiss,
}: {
  readonly viewModel: Omit<SystemStateViewModel, 'secondaryAction'>
  readonly onAction?: () => void
  readonly onDismiss?: () => void
}) {
  return (
    <aside
      className={`system-banner system-banner--${viewModel.tone}`}
      role={viewModel.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="system-banner__icon">
        <Icon name={viewModel.icon} />
      </span>
      <span className="system-banner__copy">
        <strong>{viewModel.title}</strong>
        <small>{viewModel.description}</small>
      </span>
      {viewModel.primaryAction && onAction ? (
        <button type="button" onClick={onAction}>
          {viewModel.primaryAction.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          className="system-banner__dismiss"
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
        >
          <Icon name="close" />
        </button>
      ) : null}
    </aside>
  )
}

export type MicrophonePermissionViewState =
  | 'prompt'
  | 'denied'
  | 'unsupported'
  | 'unknown'

export function MicrophonePermissionCard({
  state,
  description,
  primaryAction,
  secondaryAction,
  onPrimaryAction,
  onSecondaryAction,
}: {
  readonly state: MicrophonePermissionViewState
  readonly description: string
  readonly primaryAction: SystemActionViewModel
  readonly secondaryAction?: SystemActionViewModel
  readonly onPrimaryAction: () => void
  readonly onSecondaryAction?: () => void
}) {
  const copy: Record<
    MicrophonePermissionViewState,
    Pick<SystemStateViewModel, 'title' | 'tone'>
  > = {
    prompt: { title: '需要麦克风权限', tone: 'info' },
    denied: { title: '麦克风权限已关闭', tone: 'warning' },
    unsupported: { title: '当前浏览器无法录音', tone: 'error' },
    unknown: { title: '尚未确认麦克风状态', tone: 'quiet' },
  }

  return (
    <SystemStateCard
      viewModel={{
        ...copy[state],
        description,
        icon: 'mic',
        primaryAction,
        secondaryAction,
      }}
      onPrimaryAction={onPrimaryAction}
      onSecondaryAction={onSecondaryAction}
    />
  )
}
