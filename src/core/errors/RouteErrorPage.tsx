import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ErrorState } from '../../ui/index.ts'

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : '页面加载失败。'

  return (
    <main className="full-page-feedback">
      <ErrorState
        title="无法打开页面"
        description={message}
        onRetry={() => window.location.reload()}
      />
    </main>
  )
}
