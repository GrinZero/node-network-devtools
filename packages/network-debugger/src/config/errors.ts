export type NndConfigErrorCode =
  | 'NND_CONFIG_NOT_FOUND'
  | 'NND_CONFIG_LOAD_FAILED'
  | 'NND_CONFIG_INVALID'
  | 'NND_CONFIG_ENV_INVALID'

export class NndConfigError extends Error {
  constructor(
    readonly code: NndConfigErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'NndConfigError'
  }
}
