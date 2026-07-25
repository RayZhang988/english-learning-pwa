export interface ReadonlyDataSource<TValue> {
  load(signal?: AbortSignal): Promise<TValue>
}

/**
 * Shared async boundary for feature-to-UI adapters. Business modules own the
 * value; UI owns how each state is presented.
 */
export type AsyncDataState<TValue> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly value: TValue }
  | { readonly status: 'error'; readonly error: Error }
