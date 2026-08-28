import type { TraceContext } from './types'

function headerValue(headers: unknown, wantedName: string): string | undefined {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return undefined
  const wanted = wantedName.toLowerCase()
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (name.toLowerCase() !== wanted) continue
    if (Array.isArray(value)) return value.map(String).join(', ')
    if (value === undefined || value === null) return undefined
    return String(value)
  }
  return undefined
}

/** Parse an existing W3C traceparent without modifying request headers. */
export function parseTraceparent(value: string, tracestate?: string): TraceContext | undefined {
  const normalized = value.trim().toLowerCase()
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(normalized)
  if (!match) return undefined

  const [, version, traceId, parentId, traceFlags] = match
  if (version === 'ff' || /^0+$/.test(traceId) || /^0+$/.test(parentId)) return undefined

  return {
    traceparent: normalized,
    version,
    traceId,
    parentId,
    traceFlags,
    sampled: (Number.parseInt(traceFlags, 16) & 1) === 1,
    ...(tracestate?.trim() ? { tracestate: tracestate.trim() } : {})
  }
}

export function traceContextFromHeaders(headers: unknown): TraceContext | undefined {
  const traceparent = headerValue(headers, 'traceparent')
  if (!traceparent) return undefined
  return parseTraceparent(traceparent, headerValue(headers, 'tracestate'))
}

export { headerValue as sessionHeaderValue }
