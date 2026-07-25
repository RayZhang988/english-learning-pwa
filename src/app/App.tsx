import { RouterProvider } from 'react-router'
import { AppErrorBoundary } from '../core/errors/AppErrorBoundary.tsx'
import { PwaLifecycleProvider } from '../pwa/PwaLifecycleProvider.tsx'
import { LearningAppProvider } from './learning/LearningAppProvider.tsx'
import { appRouter } from './router.tsx'

export function App() {
  return (
    <AppErrorBoundary>
      <PwaLifecycleProvider>
        <LearningAppProvider>
          <RouterProvider router={appRouter} />
        </LearningAppProvider>
      </PwaLifecycleProvider>
    </AppErrorBoundary>
  )
}
