export interface FeatureModuleSlot {
  readonly id: string
  readonly ownerTask: '03' | '06' | '07' | '08'
  readonly routeBase: string
  readonly storageNamespace: string
}

/**
 * Reserved integration points. A slot is metadata, not a delivered feature.
 */
export const featureModuleSlots = [
  {
    id: 'assessment',
    ownerTask: '03',
    routeBase: 'assessment',
    storageNamespace: 'feature.assessment',
  },
  {
    id: 'vocabulary',
    ownerTask: '06',
    routeBase: 'vocabulary',
    storageNamespace: 'feature.vocabulary',
  },
  {
    id: 'listening',
    ownerTask: '07',
    routeBase: 'listening',
    storageNamespace: 'feature.listening',
  },
  {
    id: 'speaking',
    ownerTask: '08',
    routeBase: 'speaking',
    storageNamespace: 'feature.speaking',
  },
] as const satisfies readonly FeatureModuleSlot[]

export type PlannedFeatureId = (typeof featureModuleSlots)[number]['id']
