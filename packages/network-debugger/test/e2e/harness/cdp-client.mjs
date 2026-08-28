import { writeFile } from 'node:fs/promises'

import WebSocket from 'ws'

const DEFAULT_TIMEOUT_MS = 10_000

function timeoutError(label, timeoutMs) {
  return new Error(`Timed out after ${timeoutMs}ms while waiting for ${label}`)
}

function stringifyJournalEntry(entry) {
  return JSON.stringify(entry, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

/**
 * A deliberately small CDP client. It speaks JSON-RPC over a real WebSocket and
 * does not know anything about the network debugger implementation.
 */
export class CdpClient {
  #socket
  #nextCommandId = 0
  #nextSequence = 0
  #pendingCommands = new Map()
  #eventWaiters = new Set()
  #closed = false

  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl
    this.journal = []
    this.events = []
  }

  async connect({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (this.#socket) {
      throw new Error('CDP client is already connected')
    }

    const socket = new WebSocket(this.webSocketUrl)
    this.#socket = socket

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        socket.terminate()
        reject(timeoutError(`CDP WebSocket ${this.webSocketUrl}`, timeoutMs))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timer)
        socket.off('open', onOpen)
        socket.off('error', onInitialError)
        socket.off('unexpected-response', onUnexpectedResponse)
      }

      const onOpen = () => {
        cleanup()
        resolve()
      }

      const onInitialError = (error) => {
        cleanup()
        reject(error)
      }

      const onUnexpectedResponse = (_request, response) => {
        cleanup()
        reject(
          new Error(
            `Unexpected HTTP ${response.statusCode} while connecting to ${this.webSocketUrl}`
          )
        )
      }

      socket.once('open', onOpen)
      socket.once('error', onInitialError)
      socket.once('unexpected-response', onUnexpectedResponse)
    })

    socket.on('message', (data) => this.#onMessage(data))
    socket.on('error', (error) => this.#onDisconnect(error))
    socket.on('close', (code, reason) => {
      this.#onDisconnect(
        new Error(`CDP WebSocket closed (${code}): ${reason.toString() || 'no reason'}`)
      )
    })

    this.#record('connection', { state: 'open', url: this.webSocketUrl })
    return this
  }

  async command(method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const socket = this.#socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send ${method}: CDP WebSocket is not open`)
    }

    const id = ++this.#nextCommandId
    const request = { id, method, params }
    this.#record('send', request)

    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingCommands.delete(id)
        reject(timeoutError(`response to CDP command ${method} (${id})`, timeoutMs))
      }, timeoutMs)

      this.#pendingCommands.set(id, {
        method,
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })

      socket.send(JSON.stringify(request), (error) => {
        if (!error) return
        const pending = this.#pendingCommands.get(id)
        if (!pending) return
        this.#pendingCommands.delete(id)
        pending.reject(error)
      })
    })

    if (response.error) {
      const error = new Error(
        `CDP command ${method} failed (${response.error.code}): ${response.error.message}`
      )
      error.cdpError = response.error
      error.cdpResponse = response
      throw error
    }

    return {
      id,
      request,
      response,
      result: response.result
    }
  }

  waitForEvent(method, predicate = () => true, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const existing = this.events.find(
      (record) =>
        record.message.method === method && predicate(record.message.params, record.message)
    )
    if (existing) return Promise.resolve(existing)

    return new Promise((resolve, reject) => {
      const waiter = { method, predicate, resolve, reject, timer: undefined }
      waiter.timer = setTimeout(() => {
        this.#eventWaiters.delete(waiter)
        const observed = this.events.map((record) => record.message.method).join(', ')
        reject(
          new Error(
            `${timeoutError(`CDP event ${method}`, timeoutMs).message}. Observed: ${observed || 'none'}`
          )
        )
      }, timeoutMs)
      this.#eventWaiters.add(waiter)
    })
  }

  findEvents(method, predicate = () => true) {
    return this.events.filter(
      (record) =>
        record.message.method === method && predicate(record.message.params, record.message)
    )
  }

  async writeJournal(path) {
    const body = this.journal.map(stringifyJournalEntry).join('\n')
    await writeFile(path, body ? `${body}\n` : '', 'utf8')
  }

  async close({ timeoutMs = 2_000 } = {}) {
    const socket = this.#socket
    if (!socket || socket.readyState === WebSocket.CLOSED) return

    this.#closed = true
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate()
        resolve()
      }, timeoutMs)

      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.close()
    })
  }

  #record(direction, message) {
    const record = {
      sequence: ++this.#nextSequence,
      timestamp: new Date().toISOString(),
      direction,
      message
    }
    this.journal.push(record)
    return record
  }

  #onMessage(data) {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch (error) {
      this.#record('receive-invalid', { raw: data.toString(), error: String(error) })
      this.#onDisconnect(error)
      return
    }

    const record = this.#record('receive', message)
    if (message.id !== undefined) {
      const pending = this.#pendingCommands.get(message.id)
      if (!pending) return
      this.#pendingCommands.delete(message.id)
      pending.resolve(message)
      return
    }

    if (!message.method) return
    this.events.push(record)

    for (const waiter of [...this.#eventWaiters]) {
      if (waiter.method !== message.method) continue
      try {
        if (!waiter.predicate(message.params, message)) continue
      } catch (error) {
        clearTimeout(waiter.timer)
        this.#eventWaiters.delete(waiter)
        waiter.reject(error)
        continue
      }
      clearTimeout(waiter.timer)
      this.#eventWaiters.delete(waiter)
      waiter.resolve(record)
    }
  }

  #onDisconnect(error) {
    if (this.#closed) return
    this.#record('connection', { state: 'closed', error: String(error) })
    for (const [id, pending] of this.#pendingCommands) {
      pending.reject(new Error(`CDP connection ended before ${pending.method} (${id}): ${error}`))
    }
    this.#pendingCommands.clear()
    for (const waiter of this.#eventWaiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(`CDP connection ended while waiting for ${waiter.method}: ${error}`))
    }
    this.#eventWaiters.clear()
  }
}
