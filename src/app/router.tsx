import { createHashRouter } from 'react-router'
import { featureModules } from './module-registry.ts'
import { RouteErrorPage } from '../core/errors/RouteErrorPage.tsx'
import {
  NotFoundPage,
  PlatformReadyPage,
  PlatformShell,
} from './platform-pages.tsx'

const featureRoutes = featureModules.flatMap((module) => module.routes)

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
      ...featureRoutes,
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
])
