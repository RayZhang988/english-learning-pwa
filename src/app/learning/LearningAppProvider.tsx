import {
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { LearningAppContext } from './learning-app-context.ts'
import {
  learningAppCoordinator,
  type LearningAppCoordinator,
  type LearningAppState,
} from './learning-app-coordinator.ts'

export function LearningAppProvider({
  children,
  coordinator = learningAppCoordinator,
}: {
  readonly children: ReactNode
  readonly coordinator?: LearningAppCoordinator
}) {
  const [state, setState] = useState<LearningAppState>(
    coordinator.state,
  )

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState)
    void coordinator.initialize()

    const refreshForForeground = () => {
      if (document.visibilityState !== 'hidden') {
        void coordinator.refreshForCurrentDate()
      }
    }
    document.addEventListener(
      'visibilitychange',
      refreshForForeground,
    )
    window.addEventListener('pageshow', refreshForForeground)
    window.addEventListener('focus', refreshForForeground)

    return () => {
      unsubscribe()
      document.removeEventListener(
        'visibilitychange',
        refreshForForeground,
      )
      window.removeEventListener('pageshow', refreshForForeground)
      window.removeEventListener('focus', refreshForForeground)
    }
  }, [coordinator])

  return (
    <LearningAppContext.Provider value={{ coordinator, state }}>
      {children}
    </LearningAppContext.Provider>
  )
}
