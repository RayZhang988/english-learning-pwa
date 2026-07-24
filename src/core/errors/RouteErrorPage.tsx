import { isRouteErrorResponse, useRouteError } from 'react-router'

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : '页面加载失败。'

  return (
    <main className="platform-shell">
      <section className="platform-message" role="alert">
        <h1>无法打开页面</h1>
        <p>{message}</p>
      </section>
    </main>
  )
}
