import type { Diagnostic } from '../types'

export class NodeNativeAdapterError extends Error {
  readonly code: string
  readonly hint?: string
  readonly diagnostics: readonly Diagnostic[]

  constructor(diagnostic: Diagnostic, diagnostics: readonly Diagnostic[] = [diagnostic]) {
    super(diagnostic.message)
    this.name = 'NodeNativeAdapterError'
    this.code = diagnostic.code
    this.hint = diagnostic.hint
    this.diagnostics = diagnostics
  }
}

export function nativeDiagnostic(
  code: string,
  message: string,
  hint?: string,
  details?: Readonly<Record<string, unknown>>,
  level: Diagnostic['level'] = 'error'
): Diagnostic {
  return {
    code,
    level,
    message,
    ...(hint ? { hint } : {}),
    ...(details ? { details } : {})
  }
}
