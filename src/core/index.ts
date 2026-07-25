export type {
  FeatureModule,
  FeatureStorageContract,
} from './contracts/feature-module.ts'
export { defineFeatureModule } from './contracts/feature-module.ts'
export type {
  AsyncDataState,
  ReadonlyDataSource,
} from './contracts/async-data.ts'
export type {
  PlatformEvent,
  PlatformEventSink,
} from './contracts/platform-event.ts'
export type {
  PortableData,
  PortablePrimitive,
} from './contracts/portable-data.ts'
export {
  AppError,
  toAppError,
  type AppErrorCode,
} from './errors/AppError.ts'
