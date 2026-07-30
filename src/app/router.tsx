import { createHashRouter } from 'react-router'
import { featureRegistry } from './module-registry.ts'
import { RouteErrorPage } from '../core/errors/RouteErrorPage.tsx'
import {
  NotFoundPage,
  PlatformReadyPage,
  PlatformShell,
} from './platform-pages.tsx'
import {
  ExtraTrainingPickerRouteHost,
  ExtraTrainingRouteHost,
} from './learning/extra-training-route-hosts.tsx'

export const appRouter = createHashRouter([
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
])
