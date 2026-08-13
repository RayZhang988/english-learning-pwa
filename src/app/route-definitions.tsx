import { RouteErrorPage } from '../core/errors/RouteErrorPage.tsx'
import { featureRegistry } from './module-registry.ts'
import {
  ExtraTrainingPickerRouteHost,
  ExtraTrainingRouteHost,
} from './learning/extra-training-route-hosts.tsx'
import {
  NotFoundPage,
  PlatformReadyPage,
  PlatformShell,
} from './platform-pages.tsx'
import { SceneVocabularyPracticeRouteHost } from './scene-vocabulary-practice-route.tsx'
import { WrongAnswerLibraryRouteHost, WrongAnswerReviewRouteHost } from './wrong-answer-library-routes.tsx'
import { ListeningVoiceDiagnosticRouteHost } from './listening-voice-diagnostic-route.tsx'
import { GrowthUpgradeRouteHost } from './learning/growth-upgrade-route-host.tsx'

/** Route definitions stay importable in Node tests without constructing browser history. */
export const appRoutes = [
  {
    path: '/',
    element: <PlatformShell />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        element: <PlatformReadyPage />,
      },
      {
        path: 'diagnostics/listening-voices',
        element: <ListeningVoiceDiagnosticRouteHost />,
      },
      { path: 'progress/growth/:domain', element: <GrowthUpgradeRouteHost /> },
      {
        path: 'practice/wrong-answers',
        element: <WrongAnswerLibraryRouteHost />,
      },
      {
        path: 'practice/wrong-answers/review',
        element: <WrongAnswerReviewRouteHost />,
      },
      {
        path: 'practice/scenes/:category/:scene',
        element: <SceneVocabularyPracticeRouteHost />,
      },
      {
        path: 'practice/*',
        element: <PlatformReadyPage />,
      },
      {
        path: 'extra-training',
        element: <ExtraTrainingPickerRouteHost />,
      },
      {
        path: 'extra-training/:moduleId',
        element: <ExtraTrainingRouteHost />,
      },
      ...featureRegistry.routes,
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]
