import { createContext, useContext } from 'react'

export interface PwaLifecycle {
  readonly offlineReady: boolean
  readonly updateAvailable: boolean
  readonly registrationError?: Error
  applyUpdate(): Promise<void>
  dismissOfflineReady(): void
  dismissUpdate(): void
}

export const PwaLifecycleContext = createContext<PwaLifecycle | undefined>(
  undefined,
)

export function usePwaLifecycle(): PwaLifecycle {
  const context = useContext(PwaLifecycleContext)
  if (!context) {
    throw new Error('usePwaLifecycle must be used inside PwaLifecycleProvider')
  }

  return context
}
