import type { ReactNode } from 'react'
import { Icon } from './icons.tsx'

interface EmptyStateProps {
  readonly title: string
  readonly description: string
  readonly details?: ReactNode
  readonly action?: ReactNode
}

export function LoadingState({ label = '正在加载' }: { readonly label?: string }) {
  return (
    <section className="feedback-card" aria-busy="true" aria-live="polite">
      <span className="feedback-loader" aria-hidden="true" />
      <p>{label}</p>
      <div className="skeleton-lines" aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  )
}

export function EmptyState({
  title,
  description,
  details,
  action,
}: EmptyStateProps) {
  return (
    <section className="feedback-card">
      <span className="feedback-icon feedback-icon--quiet">
        <Icon name="spark" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {details}
      {action}
    </section>
  )
}

export function ErrorState({
  title = '暂时无法显示',
  description,
  onRetry,
}: {
  readonly title?: string
  readonly description: string
  readonly onRetry?: () => void
}) {
  return (
    <section className="feedback-card" role="alert">
      <span className="feedback-icon feedback-icon--error">!</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry ? (
        <button className="secondary-button" type="button" onClick={onRetry}>
          <Icon name="refresh" />
          重新加载
        </button>
      ) : null}
    </section>
  )
}

export function OfflineNotice() {
  return (
    <aside className="offline-notice" role="status">
      <Icon name="wifi-off" />
      <span>
        <strong>当前处于离线状态</strong>
        <small>已下载的训练仍可使用</small>
      </span>
    </aside>
  )
}
