export type NndCliErrorCode =
  | 'NND_CLI_USAGE'
  | 'NND_CLI_INVALID_OPTION'
  | 'NND_CLI_NATIVE_UNSUPPORTED'
  | 'NND_CLI_SPAWN_FAILED'
  | 'NND_CLI_FRONTEND_OPEN_FAILED'

export class NndCliError extends Error {
  constructor(
    readonly code: NndCliErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'NndCliError'
  }
}

export function formatCliError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'NND_CLI_FAILED'
  const message = error instanceof Error ? error.message : String(error)
  return `[nnd:${code}] ${message}`
}
