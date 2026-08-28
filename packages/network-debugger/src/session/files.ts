import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { SESSION_SCHEMA_VERSION, type SessionManifest } from './types'

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function bodyFileName(requestId: string, body: Buffer): string {
  return `${sha256(requestId).slice(0, 16)}-${sha256(body)}.body`
}

export function jsonStringify(value: unknown, spacing?: number): string {
  return JSON.stringify(
    value,
    (_key, nested) => (typeof nested === 'bigint' ? nested.toString() : nested),
    spacing
  )
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${jsonStringify(value, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    await fs.rename(temporaryPath, path)
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export function resolveInside(rootDirectory: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error(`Session path must be relative: ${relativePath}`)
  const root = resolve(rootDirectory)
  const absolute = resolve(root, relativePath)
  const pathFromRoot = relative(root, absolute)
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Session path escapes its root: ${relativePath}`)
  }
  return absolute
}

export async function readSessionManifest(directory: string): Promise<SessionManifest> {
  const manifestPath = resolve(directory, 'manifest.json')
  const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Partial<SessionManifest>
  if (parsed.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported session schema version ${String(parsed.schemaVersion)} in ${manifestPath}.`
    )
  }
  if (!parsed.target || !parsed.requestIndex || !parsed.bodyIndex || !parsed.traceIndex) {
    throw new Error(`Invalid session manifest: ${manifestPath}.`)
  }
  return parsed as SessionManifest
}
