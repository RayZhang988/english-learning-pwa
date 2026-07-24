const namespacePattern = /^[a-z0-9][a-z0-9._-]*$/i

export function assertValidNamespace(namespace: string) {
  if (!namespacePattern.test(namespace)) {
    throw new TypeError(`Invalid storage namespace: ${namespace}`)
  }
}
