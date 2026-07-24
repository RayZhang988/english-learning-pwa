import { Component, type ErrorInfo, type ReactNode } from 'react'
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
        <main className="platform-shell">
          <section className="platform-message" role="alert">
            <h1>应用暂时无法继续</h1>
            <p>{this.state.error.message}</p>
            <button type="button" onClick={this.reload}>
              重新加载
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
