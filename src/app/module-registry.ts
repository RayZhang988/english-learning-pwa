import { createElement } from 'react'
import type { RouteObject } from 'react-router'
import type { FeatureModule } from '../core/contracts/feature-module.ts'
import {
  createAssessmentFeatureModule,
} from '../features/assessment/index.ts'
import {
  createVocabularyFeatureModule,
} from '../features/vocabulary/index.ts'
import {
  createListeningFeatureModule,
} from '../features/listening/index.ts'
import {
  createSpeakingFeatureModule,
} from '../features/speaking/index.ts'
import {
  ListeningTrainingRouteHost,
  SpeakingTrainingRouteHost,
  VocabularyTrainingRouteHost,
} from './learning/training-route-hosts.tsx'
import { AssessmentRouteHost } from './assessment/AssessmentRouteHost.tsx'
import {
  featureModuleSlots,
  type FeatureModuleSlot,
} from './module-slots.ts'

const identifierPattern = /^[a-z][a-z0-9-]*$/
const namespacePattern = /^[a-z0-9][a-z0-9._-]*$/i

export class FeatureRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeatureRegistrationError'
  }
}

export interface FeatureRegistry {
  readonly modules: readonly FeatureModule[]
  readonly routes: readonly RouteObject[]
  get(moduleId: string): FeatureModule | undefined
}

function registrationError(message: string): never {
  throw new FeatureRegistrationError(message)
}

function assertRelativeRoutes(
  moduleId: string,
  routes: readonly RouteObject[],
): void {
  if (routes.length === 0) {
    registrationError(`Feature "${moduleId}" must provide at least one route.`)
  }

  for (const route of routes) {
    if (
      typeof route.path === 'string' &&
      route.path.startsWith('/')
    ) {
      registrationError(
        `Feature "${moduleId}" contains a non-relative route: ${route.path}`,
      )
    }

    if (route.children) {
      assertRelativeRoutes(moduleId, route.children)
    }
  }
}

function validateModule(module: FeatureModule, slot: FeatureModuleSlot): void {
  if (!identifierPattern.test(module.id)) {
    registrationError(`Invalid feature id: ${module.id}`)
  }

  if (module.routeBase !== slot.routeBase) {
    registrationError(
      `Feature "${module.id}" must use route base "${slot.routeBase}".`,
    )
  }

  if (!identifierPattern.test(module.routeBase)) {
    registrationError(`Invalid route base: ${module.routeBase}`)
  }

  if (
    !namespacePattern.test(module.storage.namespace) ||
    module.storage.namespace !== slot.storageNamespace
  ) {
    registrationError(
      `Feature "${module.id}" must use storage namespace "${slot.storageNamespace}".`,
    )
  }

  if (
    !Number.isInteger(module.storage.schemaVersion) ||
    module.storage.schemaVersion < 1
  ) {
    registrationError(
      `Feature "${module.id}" must declare a positive schema version.`,
    )
  }

  assertRelativeRoutes(module.id, module.routes)
}

export function createFeatureRegistry(
  modules: readonly FeatureModule[],
  slots: readonly FeatureModuleSlot[] = featureModuleSlots,
): FeatureRegistry {
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const modulesById = new Map<string, FeatureModule>()
  const claimedRoutes = new Set<string>()
  const claimedNamespaces = new Set<string>()

  for (const module of modules) {
    const slot = slotsById.get(module.id)
    if (!slot) {
      registrationError(`Feature "${module.id}" has no reserved module slot.`)
    }

    if (modulesById.has(module.id)) {
      registrationError(`Feature id "${module.id}" is already registered.`)
    }

    validateModule(module, slot)

    if (claimedRoutes.has(module.routeBase)) {
      registrationError(`Route base "${module.routeBase}" is already claimed.`)
    }

    if (claimedNamespaces.has(module.storage.namespace)) {
      registrationError(
        `Storage namespace "${module.storage.namespace}" is already claimed.`,
      )
    }

    modulesById.set(module.id, module)
    claimedRoutes.add(module.routeBase)
    claimedNamespaces.add(module.storage.namespace)
  }

  const registeredModules = Object.freeze([...modulesById.values()])
  const routes = Object.freeze(
    registeredModules.map<RouteObject>((module) => ({
      path: module.routeBase,
      children: [...module.routes],
    })),
  )

  return Object.freeze({
    modules: registeredModules,
    routes,
    get(moduleId: string) {
      return modulesById.get(moduleId)
    },
  })
}

const deliveredFeatureModules: readonly FeatureModule[] = [
  createAssessmentFeatureModule(
    createElement(AssessmentRouteHost),
  ),
  createVocabularyFeatureModule(
    createElement(VocabularyTrainingRouteHost),
  ),
  createListeningFeatureModule(
    createElement(ListeningTrainingRouteHost),
  ),
  createSpeakingFeatureModule(
    createElement(SpeakingTrainingRouteHost),
  ),
]

export const featureRegistry = createFeatureRegistry(deliveredFeatureModules)
export const featureModules = featureRegistry.modules
