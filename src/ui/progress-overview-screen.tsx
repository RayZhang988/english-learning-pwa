import { Icon } from './icons.tsx'
import type { DomainProgressViewModel } from './view-models.ts'

export interface ProgressOverviewViewModel {
  readonly title: string
  readonly description: string
  readonly domains: readonly DomainProgressViewModel[]
  readonly streak: {
    readonly currentLabel: string
    readonly longestLabel: string
  }
  readonly reassessment?: {
    readonly title: string
    readonly description: string
    readonly actionLabel: string
  }
}

const trendLabels: Record<DomainProgressViewModel['trend'], string> = {
  improving: '改善',
  stable: '稳定',
  declining: '下降',
  'insufficient-evidence': '证据不足',
}

export function ProgressOverviewScreen({
  viewModel,
  onReassessment,
}: {
  readonly viewModel: ProgressOverviewViewModel
  readonly onReassessment?: () => void
}) {
  return (
    <main className="progress-screen">
      <header className="page-header">
        <span className="eyebrow">PROGRESS</span>
        <h1>{viewModel.title}</h1>
        <p>{viewModel.description}</p>
      </header>

      <section className="domain-progress-list" aria-label="专项学习进度">
        {viewModel.domains.map((domain) => (
          <article className="domain-progress-card" key={domain.domain}>
            <div className="domain-progress-card__heading">
              <div>
                <span>{domain.label}</span>
                <strong>{domain.currentLevelLabel}</strong>
              </div>
              <span className={`trend-chip trend-chip--${domain.trend}`}>
                {trendLabels[domain.trend]}
              </span>
            </div>
            <span
              className="domain-progress-card__track"
              role="progressbar"
              aria-label={`${domain.label}进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={domain.progressValue}
            >
              <i style={{ width: `${domain.progressValue}%` }} />
            </span>
            <div className="domain-progress-card__metrics">
              <span>
                <small>变化</small>
                <strong>{domain.levelChangeLabel}</strong>
              </span>
              <span>
                <small>近期表现</small>
                <strong>{domain.performanceLabel}</strong>
              </span>
              <span>
                <small>保持</small>
                <strong>{domain.retentionLabel}</strong>
              </span>
              <span>
                <small>掌握</small>
                <strong>{domain.masteryLabel}</strong>
              </span>
            </div>
            <p className="domain-progress-card__confidence">
              {domain.confidenceLabel}
            </p>
            {domain.commonErrors.length > 0 ? (
              <div className="error-tags" aria-label={`${domain.label}常见问题`}>
                {domain.commonErrors.map((error) => (
                  <span key={error}>{error}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="streak-summary">
        <span className="streak-summary__icon">
          <Icon name="spark" />
        </span>
        <div>
          <span>连续学习</span>
          <strong>{viewModel.streak.currentLabel}</strong>
        </div>
        <div>
          <span>最长记录</span>
          <strong>{viewModel.streak.longestLabel}</strong>
        </div>
      </section>

      {viewModel.reassessment && onReassessment ? (
        <section className="reassessment-card">
          <div>
            <span className="eyebrow">REASSESSMENT</span>
            <h2>{viewModel.reassessment.title}</h2>
            <p>{viewModel.reassessment.description}</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={onReassessment}
          >
            {viewModel.reassessment.actionLabel}
            <Icon name="arrow-right" />
          </button>
        </section>
      ) : null}
    </main>
  )
}
