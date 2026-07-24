import { RouterProvider } from 'react-router'
import { AppErrorBoundary } from '../core/errors/AppErrorBoundary.tsx'
import { PwaLifecycleProvider } from '../pwa/PwaLifecycleProvider.tsx'
import { appRouter } from './router.tsx'

export function App() {
  return (
    <AppErrorBoundary>
      <PwaLifecycleProvider>
        <RouterProvider router={appRouter} />
      </PwaLifecycleProvider>
    </AppErrorBoundary>
  )
}
