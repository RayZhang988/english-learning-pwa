import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '../../ui/index.ts'
import { toAppError, type AppError } from './AppError.ts'

interface Props {
  readonly children: ReactNode
}

interface State {
  readonly error?: AppError
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: unknown): State {
    return { error: toAppError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught application error', error, info.componentStack)
  }

  private readonly reload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <main className="full-page-feedback">
          <ErrorState
            title="应用暂时无法继续"
            description={this.state.error.message}
            onRetry={this.reload}
          />
        </main>
      )
    }

    return this.props.children
  }
}
