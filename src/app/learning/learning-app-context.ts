import { createContext, useContext } from 'react'
import type {
  LearningAppCoordinator,
  LearningAppState,
} from './learning-app-coordinator.ts'

export interface LearningAppContextValue {
  readonly coordinator: LearningAppCoordinator
  readonly state: LearningAppState
}

export const LearningAppContext =
  createContext<LearningAppContextValue | null>(null)

export function useLearningApp(): LearningAppContextValue {
  const value = useContext(LearningAppContext)
  if (!value) {
    throw new Error(
      'useLearningApp must be used inside LearningAppProvider.',
    )
  }
  return value
}
