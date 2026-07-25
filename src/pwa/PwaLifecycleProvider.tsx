import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  PwaLifecycleContext,
  type PwaLifecycle,
} from './pwa-lifecycle-context.ts'
import { PwaUpdateReloadGuard } from './pwa-update-reload-guard.ts'

export function PwaLifecycleProvider({
  children,
}: {
  readonly children: ReactNode
}) {
  const [registrationError, setRegistrationError] = useState<Error>()
  const serviceWorker =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? navigator.serviceWorker
      : undefined
  const reloadGuard = useRef<PwaUpdateReloadGuard>(undefined)
  if (!reloadGuard.current) {
    reloadGuard.current = new PwaUpdateReloadGuard(
      serviceWorker?.controller ?? null,
    )
  }

  const reloadForUpdate = useCallback(() => {
    reloadGuard.current?.requestReload(
      serviceWorker?.controller ?? null,
      () => window.location.reload(),
    )
  }, [serviceWorker])

  useEffect(() => {
    if (!serviceWorker) {
      return
    }

    const handleControllerChange = () => {
      reloadGuard.current?.onControllerChange(
        serviceWorker.controller,
        () => window.location.reload(),
      )
    }

    serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () =>
      serviceWorker.removeEventListener(
        'controllerchange',
        handleControllerChange,
      )
  }, [serviceWorker])

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [updateAvailable, setUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedReload: reloadForUpdate,
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
