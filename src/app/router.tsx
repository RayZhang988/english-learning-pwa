import { createHashRouter } from 'react-router'
import { featureRegistry } from './module-registry.ts'
import { RouteErrorPage } from '../core/errors/RouteErrorPage.tsx'
import {
  NotFoundPage,
  PlatformReadyPage,
  PlatformShell,
} from './platform-pages.tsx'

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
      ...featureRegistry.routes,
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
])
