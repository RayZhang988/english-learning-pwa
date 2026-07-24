export function createRecordId(namespace: string, key: string) {
  return `${namespace}\u0000${key}`
}
