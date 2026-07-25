import type {
  PortableData,
  PortablePrimitive,
} from '../core/contracts/portable-data.ts'

export type { PortablePrimitive }
export type PortableValue = PortableData

function isPlainObject(value: object) {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The namespace store intentionally accepts only JSON-portable data.
 * Binary audio belongs in the recording or offline-asset stores, not here.
 */
export function assertPortableValue(
  value: unknown,
  path = 'value',
  ancestors = new Set<object>(),
): asserts value is PortableValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number`)
    }
    return
  }

  if (typeof value !== 'object') {
    throw new TypeError(`${path} is not JSON-portable`)
  }

  if (ancestors.has(value)) {
    throw new TypeError(`${path} contains a circular reference`)
  }

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError(`${path} contains a sparse array slot`)
        }
        assertPortableValue(value[index], `${path}[${index}]`, ancestors)
      }
      return
    }

    if (!isPlainObject(value)) {
      throw new TypeError(`${path} contains a non-plain object`)
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new TypeError(`${path} contains a symbol key`)
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor?.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new TypeError(`${path}.${key} is not a plain data property`)
      }

      assertPortableValue(descriptor.value, `${path}.${key}`, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}
