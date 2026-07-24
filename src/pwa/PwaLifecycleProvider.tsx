import {
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  PwaLifecycleContext,
  type PwaLifecycle,
} from './pwa-lifecycle-context.ts'

export function PwaLifecycleProvider({
  children,
}: {
  readonly children: ReactNode
}) {
  const [registrationError, setRegistrationError] = useState<Error>()
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [updateAvailable, setUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      setRegistrationError(
        error instanceof Error ? error : new Error(String(error))
      )
      console.error('Service worker registration failed', error)
    },
  })

  const value = useMemo<PwaLifecycle>(
    () => ({
      offlineReady,
      updateAvailable,
      registrationError,
      applyUpdate: async () => {
        await updateServiceWorker(true)
      },
      dismissOfflineReady: () => setOfflineReady(false),
      dismissUpdate: () => setUpdateAvailable(false),
    }),
    [
      offlineReady,
      registrationError,
      setOfflineReady,
      setUpdateAvailable,
      updateAvailable,
      updateServiceWorker,
    ],
  )

  return (
    <PwaLifecycleContext.Provider value={value}>
      {children}
    </PwaLifecycleContext.Provider>
  )
}
