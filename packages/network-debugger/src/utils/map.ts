export function headersToObject<T extends Headers>(map: T) {
  const obj: Record<string, string> = {}
  map.forEach((value, key) => {
    // Header names are user-controlled; define the property directly so the
    // legacy `__proto__` setter cannot swallow an otherwise valid entry.
    Object.defineProperty(obj, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  })

  return obj
}
