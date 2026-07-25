export type PortablePrimitive = string | number | boolean | null

/**
 * Data allowed to cross module boundaries or enter local JSON backups.
 */
export type PortableData =
  | PortablePrimitive
  | readonly PortableData[]
  | { readonly [key: string]: PortableData }
