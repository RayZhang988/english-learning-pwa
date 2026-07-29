import { RouterProvider } from 'react-router'
import { AppErrorBoundary } from '../core/errors/AppErrorBoundary.tsx'
import { PwaLifecycleProvider } from '../pwa/PwaLifecycleProvider.tsx'
import { trainingTestMode } from '../config/training-test-mode.ts'
import { TrainingTestModeBanner } from '../ui/index.ts'
import { LearningAppProvider } from './learning/LearningAppProvider.tsx'
import { appRouter } from './router.tsx'

export function App() {
  return (
    <AppErrorBoundary>
      <PwaLifecycleProvider>
        <LearningAppProvider>
          {trainingTestMode.enabled ? (
            <TrainingTestModeBanner
              wallSeconds={trainingTestMode.wallSeconds}
            />
          ) : null}
          <RouterProvider router={appRouter} />
        </LearningAppProvider>
      </PwaLifecycleProvider>
    </AppErrorBoundary>
  )
}
