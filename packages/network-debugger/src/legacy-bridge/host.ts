import type { Diagnostic } from '../adapters/types'
import { RequestCenter } from '../fork/request-center'
import { loadPlugin } from '../fork/module'
import type { LegacyBridgeOptions, LegacyChildMessage, LegacyParentMessage } from './contracts'
import { LEGACY_BRIDGE_OPTIONS_ENV } from './client'

export interface LegacyBridgeHostProcess {
  env: NodeJS.ProcessEnv
  send?: (message: LegacyChildMessage, callback?: (error: Error | null) => void) => boolean
  on(event: 'message', listener: (message: unknown) => void): unknown
  on(event: 'disconnect', listener: () => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'disconnect', listener: () => void): unknown
  disconnect?: () => void
  connected?: boolean
  exit?: (code?: number) => never | void
}

export interface LegacyBridgeHostDependencies {
  process?: LegacyBridgeHostProcess
  createCenter?: (options: {
    serverPort?: number
    targetId?: string
    title?: string
    autoOpenDevtool?: boolean
  }) => RequestCenter
  loadPlugins?: (center: RequestCenter) => void
}

function parseOptions(env: NodeJS.ProcessEnv): LegacyBridgeOptions {
  const serialized = env[LEGACY_BRIDGE_OPTIONS_ENV]
  if (!serialized) throw new Error(`${LEGACY_BRIDGE_OPTIONS_ENV} is required.`)
  const value = JSON.parse(serialized) as Partial<LegacyBridgeOptions>
  if (typeof value.host !== 'string' || typeof value.targetPort !== 'number') {
    throw new Error(`${LEGACY_BRIDGE_OPTIONS_ENV} is invalid.`)
  }
  return {
    host: value.host,
    targetPort: value.targetPort,
    ...(typeof value.targetId === 'string' ? { targetId: value.targetId } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {})
  }
}

function send(processLike: LegacyBridgeHostProcess, message: LegacyChildMessage): void {
  if (!processLike.send || processLike.connected === false) return
  try {
    processLike.send(message)
  } catch {
    // Parent teardown can race a final diagnostic/disposed acknowledgement.
  }
}

/** Start and own one RequestCenter inside the forked Legacy child. */
export async function runLegacyBridgeHost(
  dependencies: LegacyBridgeHostDependencies = {}
): Promise<() => Promise<void>> {
  const processLike = dependencies.process ?? (process as unknown as LegacyBridgeHostProcess)
  const options = parseOptions(processLike.env)
  const createCenter =
    dependencies.createCenter ?? ((centerOptions) => new RequestCenter(centerOptions))
  const center = createCenter({
    serverPort: options.targetPort || 0,
    ...(options.targetId ? { targetId: options.targetId } : {}),
    ...(options.title ? { title: options.title } : {}),
    autoOpenDevtool: false
  })
  ;(dependencies.loadPlugins ?? loadPlugin)(center)

  let captureChain = Promise.resolve()
  let closing: Promise<void> | undefined

  const close = (notifyParent = true) => {
    if (closing) return closing
    closing = captureChain
      .catch(() => undefined)
      .then(() => center.close())
      .then(() => {
        if (notifyParent && processLike.connected !== false) {
          send(processLike, { type: 'disposed' })
        }
        processLike.off('message', onMessage)
        processLike.off('disconnect', onDisconnect)
        if (processLike.connected !== false) processLike.disconnect?.()
        // This module runs in a dedicated bridge process. Explicitly exiting
        // after all owned resources have closed prevents an IPC-disconnected
        // child from becoming an orphan if its parent is terminated mid-dispose.
        processLike.exit?.(0)
      })
    return closing
  }

  const onDisconnect = () => {
    void close(false)
  }

  const onMessage = (message: unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return
    const parentMessage = message as LegacyParentMessage
    if (parentMessage.type === 'dispose') {
      void close(true)
      return
    }
    if (parentMessage.type === 'capture') {
      captureChain = captureChain.then(() => {
        center.handleCaptureEvent(parentMessage.event)
      })
      void captureChain.catch((error) => {
        const diagnostic: Diagnostic = {
          code: 'NND_LEGACY_CAPTURE_FAILED',
          level: 'error',
          message: error instanceof Error ? error.message : String(error),
          details: { eventType: parentMessage.event.type }
        }
        send(processLike, { type: 'diagnostic', diagnostic })
      })
    }
  }

  processLike.on('message', onMessage)
  processLike.on('disconnect', onDisconnect)
  try {
    const target = await center.ready
    send(processLike, { type: 'ready', target })
  } catch (error) {
    send(processLike, {
      type: 'diagnostic',
      diagnostic: {
        code: 'NND_LEGACY_TARGET_START_FAILED',
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
        hint: 'Verify that the requested Legacy target port is available.'
      }
    })
    processLike.off('message', onMessage)
    processLike.off('disconnect', onDisconnect)
    await center.close().catch(() => undefined)
    throw error
  }

  return () => close(true)
}
