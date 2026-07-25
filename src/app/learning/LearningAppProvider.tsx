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
    return unsubscribe
  }, [coordinator])

  return (
    <LearningAppContext.Provider value={{ coordinator, state }}>
      {children}
    </LearningAppContext.Provider>
  )
}
