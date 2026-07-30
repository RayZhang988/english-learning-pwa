import { createHashRouter } from 'react-router'
import { appRoutes } from './route-definitions.tsx'

export { appRoutes } from './route-definitions.tsx'

export const appRouter = createHashRouter(appRoutes)
